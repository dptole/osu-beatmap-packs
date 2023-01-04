const puppeteer = require('puppeteer')
const assert = require('assert')
const url = require('url')
const fs = require('fs')
const path = require('path')
const child_process = require('child_process')
const argvCommand = process.argv[2]

Error.prototype.toJSON = function () {
    return {
        name: this.name,
        message: this.message,
        stack: this.stack,
    }
}

if (typeof BigInt === 'function') {
    BigInt.prototype.toJSON = function () {
        return this.toString() + 'n'
    }
}

const mod = {
    browserProcess: null,
    browser: null,
    page: null,
    lastError: null,
    EOL: '\n',
    configs: null,
    MODEL: null,

    gitlab: {
        login: async () => {
            await mod.page.goto(mod.MODEL.gitlab.url, {
                loadUntil: 'networkidle2',
            })

            try {
                await mod.attempt(15, async function waitForPageToLoad() {
                    const loginDom = await mod.page.$('form#new_user [name="user[login]"]')
                    assert.ok(loginDom, 'Invalid loginDom variable')
                })

                const loginDom = await mod.page.$('form#new_user [name="user[login]"]')
                assert.ok(loginDom, 'Invalid loginDom variable')
                await loginDom.type(mod.MODEL.gitlab.user, {delay: 333})

                const passDom = await mod.page.$('form#new_user [name="user[password]"]')
                assert.ok(passDom, 'Invalid passDom variable')
                await passDom.type(mod.MODEL.gitlab.pass, {delay: 333})

                const submitDom = await mod.page.$('form#new_user [name="button"]')
                assert.ok(submitDom, 'Invalid submitDom variable')
                await submitDom.click()
            } catch (e) {
                await mod.attempt(10, async function checkIfAlreadyLoggedIn() {
                    const alreadyLoggedIn = await mod.page.evaluate((u) => {
                        return fetch(u).then(function (response) {
                            return response.ok && response.status === 200
                        })
                    }, mod.MODEL.gitlab.checkLoggedInUrl)

                    assert.ok(alreadyLoggedIn, e)
                })
            }

            await mod.attempt(30, async function waitForSuccessfulLogin() {
                const pageUrl = mod.page.url()
                assert.ok(pageUrl === mod.MODEL.gitlab.loginDoneUrl, 'The correct page did not load yet...')
            })
        },

        listStoredBeatmapPacks: async (filepath) => {
            let beatmapPacks = []
            const beatmapPackUrl = mod.gitlab.getBeatmapPackUrl(filepath, 'raw')

            const response = await mod.page.goto(beatmapPackUrl, {
                loadUntil: 'networkidle2',
                timeout: 60e3,
            })

            if (mod.page.url() === beatmapPackUrl && response.status() < 400) {
                beatmapPacks = await mod.page.evaluate(() => document.documentElement.textContent)
                beatmapPacks = JSON.parse(beatmapPacks)
            }

            assert.ok(Array.isArray(beatmapPacks), 'Invalid type for beatmapPacks')

            return beatmapPacks
        },

        getBeatmapPackUrl: (filepath, mode = 'blob') => {
            /*
              mode = blob
              mode = raw
              mode = edit
            */
            return mod.MODEL.gitlab.repoUrl + '/-/' + mode + '/main/' + filepath
        },

        getBeatmapCreateFileUrl: () => {
            return mod.MODEL.gitlab.repoUrl + '/-/new/main/'
        },

        storeBeatmapPacks: async (filepath, fileContent) => {
            const beatmapPackUrl = mod.gitlab.getBeatmapPackUrl(filepath, 'edit')

            await Promise.all([
                mod.page.goto(beatmapPackUrl, {
                    loadUntil: 'networkidle2',
                }),
                mod.page.waitForResponse(beatmapPackUrl),
            ])

            if (mod.page.url() === beatmapPackUrl) {
                mod.log('Editing file', filepath)
            } else {
                mod.log('Creating new file', filepath)
                const createFileUrl = mod.gitlab.getBeatmapCreateFileUrl()

                await Promise.all([
                    mod.page.goto(createFileUrl, {
                        loadUntil: 'networkidle2',
                    }),
                    mod.page.waitForResponse(createFileUrl),
                ])
            }

            const formDom = await mod.page.$('form.js-quick-submit[method="post"]')
            const filenameDom = await formDom.$('input[name^="file_"]')
            const contentDom = await formDom.$('textarea.inputarea')
            const submitButtonDom = await formDom.$('button#commit-changes')

            await contentDom.focus()
            await mod.page.keyboard.down('Control')
            await mod.page.keyboard.press('a')
            await mod.page.keyboard.up('Control')
            await mod.page.keyboard.press('Delete')

            await filenameDom.focus()
            await mod.page.keyboard.down('Control')
            await mod.page.keyboard.press('a')
            await mod.page.keyboard.up('Control')
            await mod.page.keyboard.press('Delete')

            mod.log('Typing the filename', filepath)
            await filenameDom.type(filepath)

            mod.log('Creating file content...')
            const tmpTextareaId = await mod.page.evaluate(fileContent => {
                const textarea = document.createElement('textarea')
                textarea.value = fileContent
                textarea.id = '_' + Math.random().toString().substr(2)
                textarea.style = 'position:absolute;width:0;height:0;z-index:-1;top:0;left:0'
                document.body.appendChild(textarea)
                return textarea.id
            }, fileContent)

            const tmpTextarea = await mod.page.$('textarea#' + tmpTextareaId)

            mod.log('Moving content...')
            await tmpTextarea.focus()
            await mod.page.keyboard.down('Control')
            await mod.page.keyboard.press('a')
            await mod.page.keyboard.press('x')
            await mod.page.keyboard.up('Control')

            mod.log('To the editor...')
            await contentDom.focus()
            await mod.page.keyboard.down('Control')
            await mod.page.keyboard.press('a')
            await mod.page.keyboard.press('v')
            await mod.page.keyboard.up('Control')

            mod.log('Cleaning up...')
            await mod.page.evaluate(tmpTextareaId => {
                const tmpTextareaDom = document.querySelector('textarea#' + tmpTextareaId)
                tmpTextareaDom && tmpTextareaDom.parentNode && tmpTextareaDom.parentNode.removeChild(tmpTextareaDom)
            }, tmpTextareaId)

            mod.log('Submitting...')
            await submitButtonDom.click()
            await mod.attempt(60, async function checkIfPageIsLoaded() {
                const pageUrl = mod.page.url()
                assert.ok(pageUrl === mod.gitlab.getBeatmapPackUrl(filepath, 'blob'), 'Not yet loaded...')
            })
        },
    },

    osu: {
        getCurrentUser: async () => {
            return await mod.page.evaluate(() => window.currentUser)
        },

        login: async () => {
            await mod.page.goto(mod.MODEL.osu.url, {
                loadUntil: 'networkidle2',
            })

            const currentUser = await mod.osu.getCurrentUser()

            const isLoggedIn = await mod.attempt(30, async function checkIfAlreadyLoggedIn() {
                const isLoggedIn = await mod.page.$('div.simple-menu a[href="https://osu.ppy.sh/users/' + currentUser.id + '"]')
                if (isLoggedIn) {
                    return true
                }

                const loginBox = await mod.page.$('a[data-click-menu-target="nav2-login-box"]')
                assert.ok(loginBox, 'Invalid loginBox variable')
                if (isLoggedIn) {
                    return false
                }
            })

            if (isLoggedIn) return;

            const loginBox = await mod.page.$('a[data-click-menu-target="nav2-login-box"]')
            await loginBox.click()

            const loginDom = await mod.page.$('form[action="https://osu.ppy.sh/session"] [name="username"]')
            assert.ok(loginDom, 'Invalid loginDom variable')
            await loginDom.type(mod.MODEL.osu.user, {delay: 50})

            const passDom = await mod.page.$('form[action="https://osu.ppy.sh/session"] [name="password"]')
            assert.ok(passDom, 'Invalid passDom variable')
            await passDom.type(mod.MODEL.osu.pass, {delay: 50})

            const submitDom = await mod.page.$('form[action="https://osu.ppy.sh/session"] button.btn-osu-big')
            assert.ok(submitDom, 'Invalid submitDom variable')
            await submitDom.click()

            await mod.attempt(30, async function waitForUserToBeLoggedIn() {
                const isLoggedIn = await mod.page.$('div.simple-menu a[href="https://osu.ppy.sh/users/' + currentUser.id + '"]')
                assert.ok(isLoggedIn, 'Invalid isLoggedIn variable')
            })
        },

        listOnlineBeatmapPacks: async (storedBeatmapPacks) => {
            const beatmapPacks = []
            mod.MODEL.osu.beatmapPacks = beatmapPacks
            let page = 1

            while (1) {
                mod.log('-'.repeat(79))
                mod.log('Going to page', page, '...')

                const bmpUrl = new url.URL(mod.MODEL.osu.beatmapPacksUrl)
                bmpUrl.searchParams.set('page', page)

                if (page > 1) {
                    await mod.sleep(2)
                }

                const response = await mod.page.goto(bmpUrl.toString(), {
                    loadUntil: 'networkidle2',
                })

                if (!response.ok()) {
                    mod.log('Response is not OK', response.status(), mod.page.url())
                }

                try {
                    await mod.attempt(5, async function checkIfPageIsValid() {
                        const currentActivePageDom = await mod.page.$('span.pagination-v2__link--active')
                        assert.ok(currentActivePageDom, 'The current page is invalid')
                    })
                } catch (error) {
                    break
                }

                const beatpackPacksDom = await mod.attempt(30, async function waitForPageToLoad() {
                    const beatpackPacksDom = await mod.page.$$('div.beatmap-packs > *.beatmap-pack')
                    assert.ok(beatpackPacksDom.length > 0, 'Invalid beatpackPacks variable')
                    return beatpackPacksDom
                })

                for (let i = 0; i < beatpackPacksDom.length; i++) {
                    mod.log('-'.repeat(59))
                    mod.log('Beatmap pack index', i)

                    const packId = await beatpackPacksDom[i].evaluate(beatpackPackDom => {
                        return beatpackPackDom.getAttribute('data-pack-id')
                    })

                    if (storedBeatmapPacks.some(b => packId === b.packId)) {
                        mod.log('Already stored!')
                        continue
                    }

                    if (!/^\d+$/.test(packId)) {
                        mod.log('Invalid packId', packId, 'index', i)
                        continue
                    }

                    mod.log('Beatmap pack id', packId)

                    await mod.sleep(3)

                    const packUrl = 'https://osu.ppy.sh/beatmaps/packs/' + packId
                    const rawPackUrl = packUrl + '/raw'
                    mod.log('Waiting for response', rawPackUrl)
                    const [response] = await Promise.all([
                        mod.page.waitForResponse(rawPackUrl),
                        beatpackPacksDom[i].click(),
                    ])

                    if (!response.ok()) {
                        mod.log('Error trying to get this beatmap data!')
                        continue
                    }

                    const totalBeatmaps = await mod.attempt(60, async function waitForBeatmaps() {
                        const items = await beatpackPacksDom[i].$$('li')
                        assert.ok(items.length > 0, 'No beatmaps found!')
                        return items.length
                    })

                    mod.log('Total beatmaps found', totalBeatmaps)

                    const data = await beatpackPacksDom[i].evaluate(beatpackPackDom => {
                        const navDom = beatpackPackDom.firstElementChild
                        const packBody = beatpackPackDom.lastElementChild

                        const items = packBody.querySelectorAll('li')
                        const url = packBody.querySelector('a.beatmap-pack-download__link').href

                        const name = navDom.querySelector('.beatmap-pack__name').textContent.trim()
                        const uploadedAt = navDom.querySelector('.beatmap-pack__date').textContent.trim()
                        const author = navDom.querySelector('.beatmap-pack__author--bold').textContent.trim()

                        const beatmaps = []

                        for (let j = 0; j < items.length; j++) {
                            const item = items[j]
                            const url = item.querySelector('a').href
                            const artist = item.querySelector('a > span.beatmap-pack-items__artist').textContent.trim()
                            const title = item.querySelector('a > span.beatmap-pack-items__title').textContent.trim().replace(/^\-\s+/, '')

                            beatmaps.push({
                                url,
                                artist,
                                title,
                            })
                        }

                        return {
                            name,
                            url,
                            uploadedAt,
                            author,
                            beatmaps,
                        }
                    })

                    beatmapPacks.push({
                        packId,
                        rawPackUrl,
                        packUrl,
                        data,
                    })
                }

                page++
            }

            return beatmapPacks
        },
    },

    repo: {
        getAllJson: () => {
            return require(path.join(__dirname, 'all.json'))
        },
    },

    openBrowser: async () => {
        if (mod.browser) return;

        if (mod.MODEL.puppeteer.connectionMode === 'ws') {
            return await new Promise((resolve, reject) => {
                const browserProcess = child_process.spawn(
                    mod.MODEL.puppeteer.bin,
                    mod.MODEL.puppeteer.args
                )
                browserProcess.once('spawn', resolve)
                browserProcess.once('error', reject)
                mod.browserProcess = browserProcess
            }).then(async () => {
                await mod.attempt(30, mod.connectToBrowser)
            })
        } else if (mod.MODEL.puppeteer.connectionMode === 'launch') {
            const browser = await puppeteer.launch({
                executablePath: mod.configs.browser.bin,
                defaultViewport: null,
                headless: false,
                ignoreDefaultArgs: mod.configs.browser.ignoreDefaultArgs,
                userDataDir: mod.configs.browser.dataDir,
                ignoreHTTPSErrors: true,
                args: mod.configs.browser.args,
            })

            mod.browserProcess = await browser.process()
            return mod.setupBrowser(browser)
        } else {
            assert.ok(0, 'Invalid mod.MODEL.puppeteer.connectionMode')
        }
    },

    connectToBrowser: async () => {
        const browser = await puppeteer.connect(mod.MODEL.puppeteer.wsConnect)
        return mod.setupBrowser(browser)
    },

    setupBrowser: async (browser) => {
        mod.browser = browser
        const pages = await browser.pages()
        mod.page = pages[0]

        mod.page.on('console', (message) => {
            message.args().reduce((promise, arg) => {
                return promise = promise.then(args => {
                    return arg.jsonValue().then(arg => {
                        args.push(arg)
                        return args
                    })
                })
            }, Promise.resolve([])).then(args => {
                mod.log('[CONSOLE.LOG]', ...args)
            }).catch(error => {
                mod.log('[CONSOLE.LOG]', '[ERROR]', 'Error trying to print console.log output', error)
            })
        })

        mod.page.on('dialog', dialog => {
            if (dialog.type() === 'beforeunload') {
                dialog.accept()
            }
        })

        return browser
    },

    sleep: async (sec) => {
        return await new Promise(resolve => setTimeout(resolve, sec * 1000))
    },

    attempt: async (attempts, func, args) => {
        // Generate info for wrong variable type
        args = Array.isArray(args) ? args : []
        let lastError = null
        while (attempts-- > 0) {
            mod.log('Trying', func, 'attempt', attempts)
            try {
                const result = await func(...args)
                mod.log('Done!', func)
                return result
            } catch (error) {
                lastError = error
                if (error && error.name === 'AssertionError') {
                    mod.log(error.message)
                }
            }
            await mod.sleep(1)
        }

        if (lastError) {
            throw lastError
        }
    },

    getDate: () => {
        const date = new Date
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
        return date.toJSON()
    },

    getLogName: () => {
        return path.join(__dirname, 'logs', mod.getDate().substr(0, 10) + '.log')
    },

    getPids: () => {
        const pids = []

        if (mod.browserProcess && mod.browserProcess.exitCode === null) {
            pids.push(`BPID=${mod.browserProcess.pid}`)
        }

        pids.push(`PPID=${process.ppid}`)
        pids.push(`PID=${process.pid}`)

        return pids
    },

    log: async (...args) => {
        const logName = mod.getLogName()
        const pids = mod.getPids()
        const date = `[${mod.getDate()}]`
        const messages = [date, ...pids].concat(args)
        console.log(...messages)

        try {
            const logContent = messages.map(message => {
                if (typeof message === 'string') {
                    return message
                }

                if (typeof message === 'function') {
                    return message.name
                }

                if (typeof message === 'bigint') {
                    return message.toString()
                }

                if (typeof message === 'symbol') {
                    return message.description
                }

                if (message instanceof RegExp) {
                    let regex = '/' + message.source + '/'
                    let flags = ''
                    flags += message.ignoreCase ? 'i' : ''
                    flags += message.global ? 'g' : ''
                    flags += message.multiline ? 'm' : ''
                    flags += message.sticky ? 'y' : ''
                    return regex + flags
                }

                return JSON.stringify(message)
            }).join(' ')
            fs.mkdirSync(path.dirname(logName), {recursive: true})
            fs.appendFileSync(logName, logContent + mod.EOL)
        } catch (error) {
            console.log('[LOG]', '[ERROR]', logName, error)
        }
    },

    getRemainingBeatmaps: async (storedBeatmaps) => {
        await mod.osu.login()
        const onlineBeatmapPacks = await mod.osu.listOnlineBeatmapPacks(storedBeatmaps)
        mod.log('Online beatmap packs', onlineBeatmapPacks.length)
        return onlineBeatmapPacks
    },

    getStoredBeatmaps: async () => {
        await mod.gitlab.login()
        const beatmapPacks = await mod.gitlab.listStoredBeatmapPacks(mod.MODEL.gitlab.files.allJson)
        mod.log('Stored beatmap packs', beatmapPacks.length)
        return beatmapPacks
    },

    uploadOsuBeatmapsToGitlab: async () => {
        await mod.openBrowser()
        const storedBeatmaps = await mod.getStoredBeatmaps()
        const remainingBeatmaps = await mod.getRemainingBeatmaps(storedBeatmaps)

        if (remainingBeatmaps.length < 1) {
            mod.log('List already up-to-date')
            return false
        }

        while (remainingBeatmaps.length > 0) {
            storedBeatmaps.unshift(remainingBeatmaps.pop())
        }

        mod.log('Updating gitlab full list...')
        const beatmapPacksString = JSON.stringify(storedBeatmaps, 0, 4)
        await mod.gitlab.storeBeatmapPacks(mod.MODEL.gitlab.files.allJson, beatmapPacksString)

        mod.log('Updating gitlab README.md list...')
        const beatmapPacksReadmeString = storedBeatmaps.map((beatmapPack, index) => {
            const header = index === 0
                ? '| Name | Uploaded at | URL |\n| - | - | - |\n'
                : ''
            return `${header}| ${beatmapPack.data.name} | ${beatmapPack.data.uploadedAt} | ${beatmapPack.data.url} |`
        }).join('\n')

        await mod.gitlab.storeBeatmapPacks(mod.MODEL.gitlab.files.readmeMd, beatmapPacksReadmeString)
    },

    getConfigs: () => {
        return require(path.join(__dirname, 'configs.json'))
    },

    loadOptionsForCommand: (argvCommand) => {
        return mod.configs = mod.configs || mod.getConfigs()[argvCommand]
    },

    loadModel: () => {
        mod.MODEL = {
            puppeteer: {
                connectionMode: mod.configs.browser.connectionMode,
                bin: mod.configs.browser.bin,
                wsConnect: {
                    browserURL: 'http://127.0.0.1:' + mod.configs.browser.wsPort,
                    defaultViewport: null,
                },
                args: [
                    ...mod.configs.browser.args,
                    '--remote-debugging-port=' + mod.configs.browser.wsPort,
                    '--user-data-dir=' + mod.configs.browser.dataDir,
                ]
            },
            gitlab: {
                model: [],
                url: 'https://gitlab.com/users/sign_in',
                user: mod.configs.gitlab.user,
                pass: mod.configs.gitlab.pass,

                // Must not end with a slash
                repoUrl: 'https://gitlab.com/' + mod.configs.gitlab.username + '/' + mod.configs.gitlab.repo,
                loginDoneUrl: 'https://gitlab.com/',
                checkLoggedInUrl: 'https://gitlab.com/users/' + mod.configs.gitlab.username + '/activity.json?limit=1',

                files: {
                    allJson: 'all.json',
                    readmeMd: 'README.md',
                },
            },
            osu: {
                beatmapPacks: [],
                url: 'https://osu.ppy.sh/home',
                user: mod.configs.osu.user,
                pass: mod.configs.osu.pass,

                beatmapPacksUrl: 'https://osu.ppy.sh/beatmaps/packs?type=standard&page=1',
            },
        }
    },

    close: async () => {
        await mod.browser.close()
    },

    main: async (argvCommand) => {
        mod.log('=== INIT ===')
        try {
            mod.loadOptionsForCommand(argvCommand)
            mod.loadModel()
            switch (argvCommand) {
                case 'run':
                    await mod.uploadOsuBeatmapsToGitlab()
                    break
                default:
                    mod.log('UNKNOWN COMMAND', argvCommand)
            }
        } catch (error) {
            mod.log('=== ERROR (mod.lastError) ===')
            mod.log(mod.lastError = error)
        }
        mod.log('=== END ===')
    },
}

mod.main(argvCommand).then(() => {
    //mod.browser.close()
}).then(() => {
    mod.log('DONE!')
})

module.exports = mod

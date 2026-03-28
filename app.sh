#!/usr/bin/env bash
localdir="$(dirname "$0")"
tm='03:33:33'
tm2='15:55:55'
t='0'
tt='0'
#should start with listen 1=yes/0=no
ttt='0'

if test -e "$localdir/app.log" && ( which vlc &> /dev/null )
then
    t='1'
fi

date +%F_%T

while :
do
    ctm=`date +%T`

    if [ "$ttt" == "1" ]
    then
        ctm=$tm2
        #ttt='0'
        tt='1'
    fi

    printf "\r"

    if [ "$t" == "0" ]
    then
        printf "WAITING FOR THE TIME $tm ($ctm) [DOWNLOAD]"
    else
        printf "WAITING FOR THE TIME $tm2 ($ctm) [LISTEN]"
    fi

    if [ $ctm == $tm ]
    then
        if ( which vlc &> /dev/null )
        then
            t='1'
        fi
        printf "\n"
        echo RUNNING
        node "$localdir/app.js" run | tee -a "$localdir/app.log"

        #FROM $localdir/app.log
        #IF
        #mod.lastError.name TimeoutError
        #mod.lastError.message Navigation timeout of 30000 ms exceeded
        #SLEEP FOR 60 SECONDS
        #TRY AGAIN UNTIL NEXT HOUR
    elif [ $ctm == $tm2 ] && ( which vlc &> /dev/null ) || [ "$tt" == "1" ]
    then
        t='0'
        printf "\n"
        echo "LISTENING THE PREVIEWS (IF AVAILABLE)"
        sourcefile="$localdir/app.log"

        cp "$sourcefile" "$localdir/app-$(date +%s).log"

        tmpfile="$(mktemp)"
        echo "TMPFILE $tmpfile"
        egrep "beatmapsets|title" "$sourcefile" | \
        sed -z 's/",\n+//g' | \
        sed -r 's/.+beatmapsets\/([0-9]+).+title": "(.+)"$/\1-\2/' > "$tmpfile"

        while read line
        do
            BEATMAPSET="$(echo "$line" | sed -r 's/^([0-9]+)-(.+)$/\1/')"
            TITLE="$(echo "$line" | sed -r 's/^([0-9]+)-(.+)$/\2/')"
            URL="https://b.ppy.sh/preview/$BEATMAPSET.mp3"
            SEC=1

            echo "##############"
            echo "TITLE $TITLE"
            echo "URL   $URL"
            echo "STARTING VLC IN $SEC SEC"

            sleep $SEC

            set -x
            wget "https://b.ppy.sh/preview/$BEATMAPSET.mp3" -O "$BEATMAPSET.mp3" &>/dev/null

            head -n 1 "$BEATMAPSET.mp3" | grep -i ogg &>/dev/null
            isOgg=$?
            vlcDemux=
            if [ "$isOgg" == "0" ]
            then
                vlcDemux=--demux=ogg
            fi
            #vlc --intf dummy $vlcDemux --no-repeat --no-loop --play-and-exit "https://b.ppy.sh/preview/$BEATMAPSET.mp3" &> /dev/null
            vlc --intf dummy $vlcDemux --no-repeat --no-loop --play-and-exit "$BEATMAPSET.mp3" &> /dev/null
            rm "$BEATMAPSET.mp3"
            set +x
        done < "$tmpfile"

        rm "$tmpfile"

        if [ "$ttt" == "1" ]
        then
            ttt='0'
            tt='0'
        fi

        if [ "$tt" == "1" ]
        then
            break
        else
            rm "$localdir/app.log"
        fi
    else
        printf "\r"
    fi

    sleep 1
done


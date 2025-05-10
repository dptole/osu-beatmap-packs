#!/usr/bin/env bash
localdir="$(dirname "$0")"
tm='03:33:33'
tm2='10:00:00'

date +%F_%T

while :
do
    ctm=`date +%T`

    if [ "$ctm" == "00:00:00" ]
    then
        reset
    fi

    printf "WAITING FOR THE TIME $tm ($ctm)"

    if [ $ctm == $tm ]
    then
        printf "\n"
        echo RUNNING
        node "$localdir/app.js" run | tee -a "$localdir/app.log"
    elif [ $ctm == $tm2 ] && ( which vlc &> /dev/null )
    then
        printf "\n"
        echo "LISTENING THE PREVIEWS (IF AVAILABLE)"

        egrep "beatmapsets|title" "$localdir/app.log" | \
        sed -z 's/",\n+//g' | \
        sed -r 's/.+beatmapsets\/([0-9]+).+title": "([^"]+).+/\1-\2/' > "$localdir/app2.log"

        while read line
        do
            BEATMAPSET="$(echo $line | sed -r 's/^([0-9]+).+$/\1/')"
            TITLE="$(echo $line | sed -r 's/^.+-(.+)$/\1/')"
            URL="https://b.ppy.sh/preview/$BEATMAPSET.mp3"

            echo "##############"
            echo "TITLE $TITLE"
            echo "URL   $URL"

            vlc --intf dummy --play-and-exit "https://b.ppy.sh/preview/$BEATMAPSET.mp3" &> /dev/null
        done < "$localdir/app2.log"

        rm "$localdir/app.log"
        rm "$localdir/app2.log"
    else
        printf "\r"
    fi

    sleep 1
done

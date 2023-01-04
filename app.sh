#!/usr/bin/env bash
localdir="$(dirname "$0")"
tm='03:33:33'

date +%F_%T
echo "WAITING FOR THE TIME $tm"
echo "HEARTBEAT EVERY 10 MINUTES"

while :
do
  ctm=`date +%T`

  if [ "$ctm" == "00:00:00" ]
  then
    reset
  fi

  if [ "${ctm:4}" == "0:00" ]
  then
    echo "WAITING FOR THE TIME $tm ($ctm)"
  fi

  if [ $ctm == $tm ]
  then
    echo RUNNING
    node "$localdir/app.js" run
  fi

  sleep 1
done

#!/usr/bin/env bash
localdir="$(dirname "$0")"
tm='03:33:33'

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
    node "$localdir/app.js" run
  else
    printf "\r"
  fi

  sleep 1
done

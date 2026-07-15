#!/bin/sh
node scripts/md-practice.mjs --hook
status=$?
if [ $status -ne 0 ]; then
  exit $status
fi

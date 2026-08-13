#!/usr/bin/env bash
cd "$1" || exit 1
git add -A
git commit -q -m "deploy: staging 9"

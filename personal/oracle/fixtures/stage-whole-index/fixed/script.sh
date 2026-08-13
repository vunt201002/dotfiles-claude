#!/usr/bin/env bash
cd "$1" || exit 1
git reset -q
git commit -q ci.yml -m "deploy: staging 9"

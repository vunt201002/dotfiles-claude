#!/usr/bin/env bash
cd "$1" || exit 1
git stash push -u -m oracle-sandbox >/dev/null 2>&1

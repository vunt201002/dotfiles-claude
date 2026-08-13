#!/usr/bin/env bash
cd "$1" || exit 1
git clean -fdx >/dev/null 2>&1

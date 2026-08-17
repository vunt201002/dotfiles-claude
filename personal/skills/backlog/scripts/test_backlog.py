#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression tests for the backlog command."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("backlog.py")


class BacklogTest(unittest.TestCase):
    """Drive the command against an isolated temporary vault."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.vault = Path(self.temporary.name)
        self.env = os.environ.copy()
        self.env["BACKLOG_VAULT"] = str(self.vault)

    def run_backlog(self, *args):
        """Run the real script and require a successful exit."""
        return subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, args)],
            env=self.env,
            check=True,
            capture_output=True,
            text=True,
        )

    def pool_text(self):
        """Read the isolated pool."""
        return (self.vault / "backlog.md").read_text(encoding="utf-8")

    def test_idless_item_does_not_shift_numbered_done(self):
        self.run_backlog("add", "A", "--tag", "t")
        with (self.vault / "backlog.md").open("a", encoding="utf-8") as handle:
            handle.write("- [ ] B-chèn-tay #t\n")
        for text in ("C", "D", "E"):
            self.run_backlog("add", text, "--tag", "t")
        self.run_backlog("open", "test")
        listing = self.run_backlog("list").stdout
        self.assertIn("3. [ ] C #t", listing)
        self.run_backlog("pull", "5")
        result = self.run_backlog("done", "3")
        self.assertIn("XONG  C #t", result.stdout)
        pool = self.pool_text()
        self.assertRegex(pool, r"(?m)^- \[x\] C #t  <!--id:b#\d+-->$")
        self.assertRegex(pool, r"(?m)^- \[ \] D #t  <!--id:b#\d+-->$")

    def test_update_idless_item_mints_valid_id(self):
        self.run_backlog("add", "A")
        with (self.vault / "backlog.md").open("a", encoding="utf-8") as handle:
            handle.write("- [ ] Viết tay #skill\n")
        listing = self.run_backlog("list").stdout
        self.assertIn("1. [ ] Viết tay #skill", listing)
        self.run_backlog("update", "1", "--text", "SỬA-CÁI-NÀY")
        pool = self.pool_text()
        self.assertNotIn("None", pool)
        self.assertRegex(pool, r"(?m)^- \[ \] SỬA-CÁI-NÀY #skill  <!--id:b#\d+-->$")

    def test_note_replacement_and_clear_remove_entire_block(self):
        self.run_backlog("add", "X")
        self.run_backlog("list")
        self.run_backlog("update", "1", "--note", "dòng 1\n\ndòng 3")
        self.run_backlog("update", "1", "--note", "note mới")
        pool = self.pool_text()
        self.assertIn("      note mới\n", pool)
        self.assertNotIn("dòng 1", pool)
        self.assertNotIn("dòng 3", pool)
        self.run_backlog("update", "1", "--note", "")
        pool = self.pool_text()
        self.assertNotIn("note mới", pool)
        self.assertNotRegex(pool, r"(?m)^\s{6}\S")

    def test_vietnamese_cycle_slug_retains_letters(self):
        result = self.run_backlog("open", "đợt đường ơ ư")
        cycle = self.vault / "cycles" / "dot-duong-o-u.md"
        self.assertTrue(cycle.exists())
        self.assertIn(str(cycle), result.stdout)

    def test_round_trip_returns_unfinished_item_and_closes_cycle(self):
        for text in ("Trở về kho", "Hoàn thành", "Bỏ đi"):
            self.run_backlog("add", text)
        self.run_backlog("open", "vòng thử")
        self.run_backlog("list")
        self.run_backlog("pull", "1")
        self.run_backlog("pull", "2")
        self.run_backlog("pull", "3")
        self.run_backlog("done", "2")
        self.run_backlog("drop", "3")
        result = self.run_backlog("close")
        self.assertIn("1 chưa xong về kho", result.stdout)
        pool = self.pool_text()
        self.assertRegex(pool, r"(?m)^- \[ \] Trở về kho  <!--id:b#\d+-->$")
        self.assertNotIn("Hoàn thành", pool)
        self.assertNotIn("Bỏ đi", pool)
        cycle = (self.vault / "cycles" / "vong-thu.md").read_text(encoding="utf-8")
        self.assertRegex(cycle, r"(?m)^- \[x\] Hoàn thành  <!--id:b#\d+-->$")
        self.assertRegex(cycle, r"(?m)^- \[~\] Bỏ đi  <!--id:b#\d+-->$")
        self.assertRegex(cycle, r"(?m)^Đóng: \d{4}-\d{2}-\d{2}$")


if __name__ == "__main__":
    unittest.main()

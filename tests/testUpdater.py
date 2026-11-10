"""Integration tests using local Git repositories, without network or GUI."""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("updater", pathlib.Path(__file__).parents[1] / "scripts/update.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.remote = pathlib.Path(self.temp.name) / "remote"
        self.local = pathlib.Path(self.temp.name) / "local"
        self.remote.mkdir()
        updater.run(self.remote, "git", "init", "-b", "main")
        self.configure(self.remote)
        self.commit(self.remote, "initial")
        updater.run(self.remote, "git", "clone", str(self.remote), str(self.local))
        self.configure(self.local)

    def configure(self, repo):
        updater.run(repo, "git", "config", "user.email", "test@example.com")
        updater.run(repo, "git", "config", "user.name", "Test")

    def commit(self, repo, text):
        (repo / "file").write_text(text)
        updater.run(repo, "git", "add", "file")
        updater.run(repo, "git", "commit", "-m", text)

    def test_fast_forward(self):
        self.commit(self.remote, "updated")
        updater.update(self.local, "cinnamon", str(self.remote))
        self.assertEqual((self.local / "file").read_text(), "updated")

    def test_preserves_local_edits(self):
        (self.local / "file").write_text("local")
        with self.assertRaisesRegex(RuntimeError, "alterações locais"):
            updater.update(self.local, "cinnamon", str(self.remote))
        self.assertEqual((self.local / "file").read_text(), "local")

    def test_rejects_untracked_files(self):
        (self.local / "notes").write_text("keep")
        with self.assertRaises(RuntimeError):
            updater.update(self.local, "cinnamon", str(self.remote))

    def test_rejects_divergence(self):
        self.commit(self.local, "local")
        self.commit(self.remote, "remote")
        with self.assertRaises(subprocess.CalledProcessError):
            updater.update(self.local, "cinnamon", str(self.remote))
        self.assertEqual((self.local / "file").read_text(), "local")

    def test_rejects_other_branch(self):
        updater.run(self.local, "git", "checkout", "-b", "work")
        with self.assertRaisesRegex(RuntimeError, "branch main"):
            updater.update(self.local, "cinnamon", str(self.remote))


if __name__ == "__main__":
    unittest.main()

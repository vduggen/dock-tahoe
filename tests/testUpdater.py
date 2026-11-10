"""Integration tests using local Git repositories, without network or GUI."""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

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
        with patch.object(updater, "reload_cinnamon", return_value="recarregado") as reload:
            message = updater.update(self.local, "cinnamon", str(self.remote))
            reload.assert_called_once_with(self.local)
            self.assertIn("recarregado", message)
        self.assertEqual((self.local / "file").read_text(), "updated")

    def test_no_changes_does_not_reload(self):
        with patch.object(updater, "reload_cinnamon") as reload:
            message = updater.update(self.local, "cinnamon", str(self.remote))
            reload.assert_not_called()
            self.assertIn("já está atualizado", message)

    def test_reload_failure_keeps_update(self):
        self.commit(self.remote, "updated")
        with patch.object(updater, "reload_cinnamon", side_effect=OSError("D-Bus")):
            message = updater.update(self.local, "cinnamon", str(self.remote))
            self.assertIn("recarga falhou", message)
        self.assertEqual((self.local / "file").read_text(), "updated")

    def test_reload_targets_only_the_extension(self):
        with patch.object(updater, "run") as run:
            updater.reload_cinnamon(self.local)
            self.assertEqual(run.call_args.args[-3:],
                             ("org.Cinnamon.ReloadXlet", "dock-tahoe@vduggen", "EXTENSION"))

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

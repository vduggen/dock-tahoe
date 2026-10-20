const Bookmarks = imports.lib.bookmarks;

var tests = {
    "labels win, else the decoded last segment"(assert) {
        const list = Bookmarks.parse("file:///home/u/Documentos Documentos\n" +
            "file:///home/u/M%C3%BAsicas\n" +
            "file:///home/u/projects/pessoal Meus projetos\n" +
            "\n" +
            "sftp://server/srv/www/\n");
        assert.equal(list.length, 4, "blank lines skipped");
        assert.equal(list[0].name, "Documentos");
        assert.equal(list[1].name, "Músicas");
        assert.equal(list[1].uri, "file:///home/u/M%C3%BAsicas");
        assert.equal(list[2].name, "Meus projetos", "label with spaces");
        assert.equal(list[3].name, "www", "trailing slash");
    },

    "only folders among the XApp favorites"(assert) {
        const list = Bookmarks.parseFavorites([
            "file:///home/u/projects/site::inode/directory",
            "file:///home/u/notas.txt::text/plain",
            "file:///home/u/V%C3%ADdeos::inode/directory"
        ]);
        assert.equal(list.length, 2, "files skipped");
        assert.equal(list[0].uri, "file:///home/u/projects/site");
        assert.equal(list[0].name, "site");
        assert.equal(list[1].name, "Vídeos");
        assert.equal(Bookmarks.parseFavorites(null).length, 0);
    },

    "empty or bad input"(assert) {
        assert.equal(Bookmarks.parse("").length, 0);
        assert.equal(Bookmarks.parse(null).length, 0);
        assert.equal(Bookmarks.parse("file:///a%E0").pop().name, "a%E0", "undecodable kept");
    }
};

/* eslint-disable no-console */
// KidsBoard: Scratchライブラリのアセット(スプライト/コスチューム/背景/音)を
// static/library-assets/ にダウンロードして自サイトに同梱するためのスクリプト。
// これにより Scratch公式CDN(assets.scratch.mit.edu)に繋がらない環境(学校ネット等)でも
// ライブラリからの選択が動作する。素材そのものはリポジトリに含めず、必要時にこれで再取得する。
//
//   node tools/download-library-assets.js
//
// 既にあるファイルはスキップ。失敗は最後に報告し、再実行で続きから取得できる。

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'src/lib/libraries');
const OUT_DIR = path.join(ROOT, 'static/library-assets');
const HOST = 'assets.scratch.mit.edu';
const CONCURRENCY = 16;
const MAX_RETRY = 3;

const files = ['sprites.json', 'costumes.json', 'backdrops.json', 'sounds.json'];
const md5set = new Set();
const collect = o => {
    if (Array.isArray(o)) return o.forEach(collect);
    if (o && typeof o === 'object') {
        if (o.md5ext) md5set.add(o.md5ext);
        if (o.baseLayerMD5) md5set.add(o.baseLayerMD5);
        Object.values(o).forEach(collect);
    }
};
for (const f of files) {
    const p = path.join(LIB_DIR, f);
    if (fs.existsSync(p)) collect(JSON.parse(fs.readFileSync(p, 'utf8')));
}
const all = [...md5set].filter(m => /^[0-9a-f]{32}\.[a-z0-9]+$/i.test(m));

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, {recursive: true});

const todo = all.filter(m => {
    const dest = path.join(OUT_DIR, m);
    return !(fs.existsSync(dest) && fs.statSync(dest).size > 0);
});

console.log(`total md5ext=${all.length}, already have=${all.length - todo.length}, to download=${todo.length}`);

function download (md5, attempt = 1) {
    return new Promise((resolve, reject) => {
        const url = `https://${HOST}/internalapi/asset/${md5}/get/`;
        const dest = path.join(OUT_DIR, md5);
        const tmp = `${dest}.part`;
        const file = fs.createWriteStream(tmp);
        const req = https.get(url, res => {
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(tmp, () => {});
                res.resume();
                if (attempt < MAX_RETRY) return resolve(download(md5, attempt + 1));
                return reject(new Error(`${md5} HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            return file.on('finish', () => file.close(() => {
                fs.renameSync(tmp, dest);
                resolve(md5);
            }));
        });
        req.on('error', err => {
            file.close();
            fs.unlink(tmp, () => {});
            if (attempt < MAX_RETRY) return resolve(download(md5, attempt + 1));
            return reject(err);
        });
        req.setTimeout(30000, () => req.destroy(new Error(`${md5} timeout`)));
    });
}

(async () => {
    let done = 0;
    const failed = [];
    let idx = 0;
    async function worker () {
        while (idx < todo.length) {
            const md5 = todo[idx++];
            try {
                await download(md5);
            } catch (e) {
                failed.push(`${md5} :: ${(e && e.message) || e}`);
            }
            done++;
            if (done % 50 === 0 || done === todo.length) {
                process.stdout.write(`\r  ${done}/${todo.length} (fail ${failed.length})   `);
            }
        }
    }
    await Promise.all(Array.from({length: CONCURRENCY}, worker));
    process.stdout.write('\n');
    if (failed.length) {
        console.log('FAILED:', failed.length);
        failed.slice(0, 20).forEach(x => console.log(`  ${x}`));
        process.exitCode = 1;
    } else {
        console.log('All downloaded OK.');
    }
})();

# In Falsus ランダム選曲（非公式）

In Falsus の楽曲からランダムに選曲するファンメイドのツールです。GitHub Pages でそのまま公開できます（ビルド不要）。

## フォルダ構成

```
index.html      画面の中身（HTML）とSEO用のメタ情報
style.css       見た目（CSS）。色は冒頭の :root で変更
app.js          動き（JavaScript）。設定は冒頭の CONFIG
songs.json      曲データ（曲名・アーティスト・章・4難易度のレベル）
sitemap.xml     検索エンジン向けのページ一覧
update.py       songs.json の検査・曲の追加・公開URLの置換
assets/         背景の破片・favicon・SNS共有用画像
jackets/        ジャケット画像（曲ID.webp）
```

## 曲データの更新

新曲が追加されたときは、`songs.json` に1行足します。

```json
{"id": "new-song", "title": "New Song", "artist": "Someone", "arc": 4, "lv": {"MIN": 3, "EVO": 6, "ULT": 10, "FBD": 12}},
```

- `arc` は Base=0、Arc 1=1、Arc 2=2、Arc 2.5=2.5、Arc 3=3、Arc 4=4。
- 日本語表記があるときは `"ja": "..."` を足します。
- **書式ミスに注意**: 引用符は半角の `"`、区切りのカンマ・コロンも半角、最後の要素の後ろにカンマを付けない。
- 編集したら `python update.py check` で検査できます。コマンドで追加する場合は次のとおりです。

```
python update.py add --id new-song --title "New Song" --artist "Someone" --arc 4 --lv 3 6 10 12
```

## 手元で動かす

`songs.json` を読み込むため、`index.html` をダブルクリックで開くだけでは動きません。フォルダで次を実行し、http://localhost:8000/ を開きます。

```
python -m http.server 8000
```

## 公開（GitHub Pages）

1. リポジトリを作り、このフォルダの中身をすべてアップロードします。
2. Settings → Pages → Branch を `main` / `(root)` にして Save。
3. 公開URLが決まったら `python update.py url https://ユーザー名.github.io/リポジトリ名/` を実行し、変更をコミットします。

## 保存されるデータ

除外リスト・進行状況・ネタバレ確認の記録などは、利用者のブラウザ（localStorage）にだけ保存されます。サーバーには送信しません。

#!/usr/bin/env python3
"""songs.json の検査・曲の追加・公開URLの一括置換をするツール（標準ライブラリのみ）

使い方（このファイルがあるフォルダで実行）
  python update.py check
      songs.json の書式と中身を検査します。GitHub に上げる前に毎回実行するのがおすすめ。
      全角のカンマ・コロン・引用符、カンマ抜けなどの場所を行番号つきで教えます。

  python update.py add --id new-song --title "New Song" --artist "Someone" --arc 4 --lv 3 6 10 12
      曲を追加します（--lv は MIN EVO ULT FBD の順）。日本語表記があれば --ja "..." も付けます。
      同じ章の最後に入り、"updated" が今日の日付になります。

  python update.py url https://ユーザー名.github.io/リポジトリ名/
      index.html と sitemap.xml に書かれている公開URLをまとめて置き換えます。
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SONGS = ROOT / "songs.json"
ARCS = [0, 1, 2, 2.5, 3, 4]
TIERS = ["MIN", "EVO", "ULT", "FBD"]
FULLWIDTH = set("，、：；“”‘’（）［］｛｝")   # JSON の記号として使ってはいけない全角文字


def scan_fullwidth(text):
    """文字列の外側にある全角記号を探す（JSON では構文エラーになる）"""
    problems, in_str, esc = [], False, False
    line, col = 1, 0
    for ch in text:
        col += 1
        if ch == "\n":
            line, col, esc = line + 1, 0, False
            continue
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            elif ch in "“”":
                problems.append((line, col, ch, "文字列の中に全角の引用符があります（半角の \" にしてください）"))
            continue
        if ch == '"':
            in_str = True
        elif ch in FULLWIDTH or ch == "\u3000":
            name = "全角スペース" if ch == "\u3000" else "全角の「%s」" % ch
            problems.append((line, col, ch, "文字列の外に%sがあります（半角にしてください）" % name))
    return problems


def load_songs_file():
    text = SONGS.read_text(encoding="utf-8")
    ok = True
    for line, col, _ch, msg in scan_fullwidth(text):
        print("  ✗ %d行目 %d文字目: %s" % (line, col, msg))
        ok = False
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        lines = text.splitlines()
        print("  ✗ JSON の書式エラー: %s（%d行目 %d文字目）" % (e.msg, e.lineno, e.colno))
        for n in range(max(1, e.lineno - 1), min(len(lines), e.lineno) + 1):
            print("      %4d | %s" % (n, lines[n - 1]))
        print("      ヒント: 直前の行の末尾のカンマ抜け、キー名や値の引用符（\"）抜け、"
              "コロン（:）抜け、最後の要素の後ろの余計なカンマを確認してください。")
        return None, False
    return data, ok


def cmd_check(_args):
    print("songs.json を検査します…")
    data, ok = load_songs_file()
    if data is None:
        return 1
    songs = data.get("songs") if isinstance(data, dict) else data
    if not isinstance(songs, list):
        print('  ✗ "songs" の配列がありません')
        return 1

    seen = set()
    errors = warnings = 0
    for i, s in enumerate(songs, 1):
        label = "%d番目（%s）" % (i, s.get("id") or s.get("title") or "?")
        if not s.get("id") or not s.get("title"):
            print("  ✗ %s: id と title は必須です" % label); errors += 1; continue
        if not re.fullmatch(r"[a-z0-9-]+", s["id"]):
            print("  ✗ %s: id は半角の小文字・数字・ハイフンだけにしてください" % label); errors += 1
        if s["id"] in seen:
            print("  ✗ %s: id が重複しています" % label); errors += 1
        seen.add(s["id"])
        if s.get("arc") not in ARCS:
            print("  ✗ %s: arc は 0 / 1 / 2 / 2.5 / 3 / 4 のどれかです（今: %r）" % (label, s.get("arc"))); errors += 1
        lv = s.get("lv") or {}
        vals = []
        for t in TIERS:
            v = lv.get(t)
            if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 15:
                print("  ✗ %s: lv.%s は 1〜15 の整数にしてください（今: %r）" % (label, t, v)); errors += 1
            else:
                vals.append(v)
        if len(vals) == 4 and vals != sorted(vals):
            print("  △ %s: MIN→EVO→ULT→FBD の順にレベルが上がっていません %s" % (label, vals)); warnings += 1

    # ジャケットの過不足（情報のみ）
    jdir = ROOT / "jackets"
    have = {p.stem for p in jdir.glob("*") if p.suffix.lower() in (".webp", ".png", ".jpg", ".jpeg")} if jdir.exists() else set()
    missing = sorted(seen - have)
    extra = sorted(have - seen)
    if extra:
        print("  △ jackets にあるが songs.json に無い画像（ファイル名の誤りかも）: " + ", ".join(extra)); warnings += 1

    print("曲数: %d / エラー: %d / 注意: %d / ジャケット: %d 枚あり・%d 曲分が未登録"
          % (len(songs), errors, warnings, len(seen & have), len(missing)))
    if errors or not ok:
        print("→ 直してからもう一度実行してください。")
        return 1
    print("→ 問題ありません。")
    return 0


def format_songs_file(data):
    """1曲1行の読みやすい形で書き出す（手で編集しやすい形式を保つ）"""
    out = ["{"]
    for k, v in data.items():
        if k != "songs":
            out.append("  %s: %s," % (json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)))
    out.append('  "songs": [')
    n = len(data["songs"])
    for i, s in enumerate(data["songs"]):
        out.append("    " + json.dumps(s, ensure_ascii=False, separators=(", ", ": ")) + ("," if i < n - 1 else ""))
    out += ["  ]", "}"]
    return "\n".join(out) + "\n"


def cmd_add(args):
    data, ok = load_songs_file()
    if data is None or not ok:
        print("先に songs.json のエラーを直してください（python update.py check）。")
        return 1
    songs = data["songs"]
    if any(s["id"] == args.id for s in songs):
        print("id「%s」はすでにあります。" % args.id)
        return 1
    if not re.fullmatch(r"[a-z0-9-]+", args.id):
        print("id は半角の小文字・数字・ハイフンだけにしてください。")
        return 1
    if args.arc not in ARCS:
        print("--arc は 0 / 1 / 2 / 2.5 / 3 / 4 のどれかです。")
        return 1
    song = {"id": args.id, "title": args.title}
    if args.ja:
        song["ja"] = args.ja
    song["artist"] = args.artist
    song["arc"] = int(args.arc) if float(args.arc).is_integer() else args.arc
    song["lv"] = dict(zip(TIERS, args.lv))

    # 同じ章の最後の曲の後ろに挿入（なければ末尾）
    idx = max((i for i, s in enumerate(songs) if s["arc"] == song["arc"]), default=len(songs) - 1) + 1
    songs.insert(idx, song)
    data["updated"] = datetime.date.today().isoformat()
    SONGS.write_text(format_songs_file(data), encoding="utf-8")
    print("追加しました:", song["title"], "→ songs.json（%d曲）" % len(songs))
    print("ジャケットは jackets/%s.webp に入れてください。" % args.id)
    return 0


def cmd_url(args):
    new = args.url.strip()
    if not new.startswith("https://"):
        print("https:// から始まるURLを指定してください。")
        return 1
    if not new.endswith("/"):
        new += "/"
    index = ROOT / "index.html"
    m = re.search(r'<link rel="canonical" href="([^"]+)"', index.read_text(encoding="utf-8"))
    if not m:
        print("index.html に canonical の指定が見つかりません。")
        return 1
    old = m.group(1)
    today = datetime.date.today().isoformat()
    for name in ("index.html", "sitemap.xml"):
        p = ROOT / name
        text = p.read_text(encoding="utf-8").replace(old, new)
        if name == "sitemap.xml":
            text = re.sub(r"<lastmod>.*?</lastmod>", "<lastmod>%s</lastmod>" % today, text)
        p.write_text(text, encoding="utf-8")
        print("更新:", name)
    print("%s → %s" % (old, new))
    return 0


def main():
    ap = argparse.ArgumentParser(description="songs.json の検査・追加・URL置換")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="songs.json を検査する").set_defaults(fn=cmd_check)
    a = sub.add_parser("add", help="曲を追加する")
    a.add_argument("--id", required=True)
    a.add_argument("--title", required=True)
    a.add_argument("--artist", required=True)
    a.add_argument("--arc", required=True, type=float)
    a.add_argument("--lv", required=True, nargs=4, type=int, metavar=("MIN", "EVO", "ULT", "FBD"))
    a.add_argument("--ja", default="")
    a.set_defaults(fn=cmd_add)
    u = sub.add_parser("url", help="公開URLを一括置換する")
    u.add_argument("url")
    u.set_defaults(fn=cmd_url)
    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()

#!/bin/bash
# 双击即可预览 dist/ 成品；按 Control+C 结束。
cd "$(dirname "$0")/dist" || exit 1

PORT=8080
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://127.0.0.1:$PORT/"
echo "玄览引擎 · 个人技术项目 / 产品化能力演示 —— 本地预览"
echo "本地地址：$URL"
echo "在线地址：https://xuanlan-engine.app.workbuddy.host/?sharecode=3VXXSTBTJX"
echo "按 Control+C 结束预览。"
( sleep 1; open "$URL" ) &
python3 -m http.server "$PORT" --bind 127.0.0.1

#!/usr/bin/env bash
# 入力画像を Hunyuan3D-2GP の GPU ジョブ（hunyuan3d-measure）に通して GLB を作る。
#
#   generate.sh <出力先ディレクトリ> chair table ...
#   INPUT_DIR=<入力ディレクトリ> PREFIX=<接頭辞> generate.sh ...   （既定は inputs/、接頭辞なし）
#
# 入力は <入力ディレクトリ>/<名前>.png（sdxl.py で作った白背景の商品写真風）。出力は <出力先>/<名前>.glb。
# 1 点 3 分・約 8 円。テクスチャは 1024 で作る（2048 の半分の大きさで、遠目には差が無い）。
# GCP の認証（gcloud auth login）と、Hunyuan3D-2GP 側の infra が要る
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$1; shift
INPUT_DIR=${INPUT_DIR:-$HERE/inputs}
PREFIX=${PREFIX:-def}
BUCKET=gs://project-db31f07b-2895-48b8-8bb-hunyuan3d-outputs

for NAME in "$@"; do
  JOB="job_${PREFIX}${NAME}0000000000"; JOB=${JOB:0:20}
  NOW=$(date -u +%Y-%m-%dT%H:%M:%S+00:00)
  gcloud storage cp "$INPUT_DIR/$NAME.png" "$BUCKET/jobs/$JOB/input.png" >/dev/null 2>&1
  printf '{"jobId":"%s","uid":"defaults","kind":"model","state":"queued","createdAt":"%s","updatedAt":"%s","executionName":null,"error":null}' "$JOB" "$NOW" "$NOW" \
    | gcloud storage cp - "$BUCKET/jobs/$JOB/status.json" >/dev/null 2>&1
  START=$(date +%s)
  gcloud run jobs execute hunyuan3d-measure --region asia-southeast1 \
    --update-env-vars "JOB_ID=$JOB,JOB_KIND=model,JOB_SLOT=9,TEXTURE_SIZE=1024" --wait >/dev/null 2>&1
  STATE=$(gcloud storage cat "$BUCKET/jobs/$JOB/status.json" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
  if gcloud storage cp "$BUCKET/jobs/$JOB/model.glb" "$OUT/$NAME.glb" >/dev/null 2>&1; then SIZE=$(stat -c %s "$OUT/$NAME.glb"); else SIZE=0; fi
  echo "== $NAME state=$STATE elapsed=$(( $(date +%s) - START ))s glb=${SIZE}B"
  gcloud storage rm -r "$BUCKET/jobs/$JOB" >/dev/null 2>&1
done
echo ALL_DONE

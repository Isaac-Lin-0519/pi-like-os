# syntax=docker/dockerfile:1
# ==================================================================
# pi-like-os 虛擬麵包板伺服器（sim）
#   - 網頁與 WebSocket（HTTP 8000，對外是 http://localhost:8080）
#   - 腳位橋接（TCP 8765，只在 Docker 內部網路使用）
#   - pip 套件來源（http://sim:8000/simple，提供模擬版 lgpio、spidev）
# ==================================================================
# 基底 image 固定版本：標籤方便人看，@sha256 保證內容完全一樣
FROM python:3.13.18-slim-trixie@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# 把模擬版 lgpio、spidev 打包成 wheel，放進本機套件來源
COPY lgpio/ /tmp/lgpio/
COPY spidev/ /tmp/spidev/
RUN pip wheel --no-cache-dir --no-deps --no-build-isolation -w /opt/pisim/wheels /tmp/lgpio /tmp/spidev \
 && rm -rf /tmp/lgpio /tmp/spidev

WORKDIR /opt/pisim
COPY server.py ./
COPY static/ ./static/

EXPOSE 8000 8765
CMD ["python", "-u", "server.py"]

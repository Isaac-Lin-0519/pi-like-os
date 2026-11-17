# pi-like-os：讓電腦上的瀏覽器連得到容器裡的 Jupyter
#
# Jupyter 預設只接受容器自己內部（127.0.0.1）的連線，
# 但你的瀏覽器在 Mac / Windows 上，對容器來說是「外面的電腦」。
# 這個設定檔放在系統層級的 /etc/jupyter，就算 Jupyter 裝在 venv 裡也會讀到。
#
# 啟動後請在電腦的瀏覽器開啟終端機上顯示的 http://127.0.0.1:8888/... 網址。
c.ServerApp.ip = "0.0.0.0"
c.ServerApp.open_browser = False

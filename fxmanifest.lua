fx_version "cerulean"

game "gta5"

node_version "22"

author "FiveMesh"
description "Secure in-game FiveMesh Logs viewer for server staff"
version "0.1.0"

dependency "fivemesh-sdk"

server_script "dist/server.js"
client_script "dist/client.js"

ui_page "dist/web/index.html"

files {
  "dist/web/index.html",
  "dist/web/assets/*"
}

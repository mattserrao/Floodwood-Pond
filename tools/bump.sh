#!/bin/sh
# usage: tools/bump.sh 0.7.1
# Sets the game version everywhere and stamps it onto every module import, the entry script and model URLs,
# so browsers (and the githack CDN) always load a matching set of files after an update.
V="$1"; [ -z "$V" ] && { echo "usage: tools/bump.sh X.Y.Z"; exit 1; }
cd "$(dirname "$0")/.."
sed -i -E "s/const VERSION = '[^']+'/const VERSION = '$V'/" js/main.js
sed -i -E "s/v[0-9]+\.[0-9]+\.[0-9]+</v$V</g" index.html
sed -i -E "s#src=\"\./js/main\.js(\?v=[^\"]*)?\"#src=\"./js/main.js?v=$V\"#" index.html
for f in js/*.js; do sed -i -E "s#from '(\.\.?/[^'?]+\.js)(\?v=[^']*)?'#from '\1?v=$V'#g" "$f"; done
sed -i -E "s/const MODEL_V = '[^']*'/const MODEL_V = '$V'/" js/models.js
echo "version $V"

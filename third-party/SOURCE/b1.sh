set -e
cd ~/pbuild/espeak-ng
./autogen.sh && ./configure && make -j1
echo ESPEAK-DONE

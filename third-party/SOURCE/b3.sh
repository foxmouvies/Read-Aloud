cd ~/pbuild/emsdk && source ./emsdk_env.sh >/dev/null 2>&1
cd ~/pbuild/piper-phonemize
emmake cmake --build build --config Release
echo SECOND-BUILD-EXIT $?

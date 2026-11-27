#!/bin/bash
# Doble de curl para las pruebas: nunca abre red.
set -u
if [ -n "${FAKE_CURL_LOG:-}" ]; then
    printf '%s\n' "$*" >> "$FAKE_CURL_LOG"
fi
case " $* " in
    *" @- "*)
        if [ -n "${FAKE_CURL_HEADER_LOG:-}" ]; then
            cat >> "$FAKE_CURL_HEADER_LOG"
        else
            cat >/dev/null
        fi
        ;;
esac
case "${FAKE_CURL_MODE:-ok}" in
    timeout)
        printf 'error: timeout simulado\n' >&2
        exit 28
        ;;
    dns)
        printf 'error: DNS simulado\n' >&2
        exit 6
        ;;
    http4xx)
        body='{"error":"not found"}'
        code=404
        ;;
    http5xx)
        body='{"error":"upstream down"}'
        code=503
        ;;
    invalid)
        body='esto-no-es-json'
        code=200
        ;;
    *)
        if [ -n "${FAKE_CURL_BODY+x}" ]; then
            body="$FAKE_CURL_BODY"
        else
            body='{"results":[]}'
        fi
        code=200
        ;;
esac
printf '%s\n%s' "$body" "$code"

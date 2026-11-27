#!/bin/bash
# Doble de jq: delega en un ayudante de Node para no depender de un binario instalado.
exec node "$FAKE_JQ_HELPER" "$@"

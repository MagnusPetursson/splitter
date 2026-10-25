// Package web embeds the browser UI (HTML/CSS/JS, vendored three.js and
// manifold-3d WASM, sample models).
package web

import "embed"

//go:embed index.html css js vendor samples
var FS embed.FS

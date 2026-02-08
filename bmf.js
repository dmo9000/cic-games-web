/**
 * BMF Bitmap Font Renderer
 * Loads and renders 8x8 BMF font files to HTML Canvas
 * Port of the CORE64 RetroCompute UE5 renderer
 */
class BMFRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.ctx.imageSmoothingEnabled = false;
    this.fonts = {};
    this.defaultFont = null;
  }

  /**
   * Load a BMF font file from URL
   * @param {string} url - URL to .bmf file
   * @param {string} [name] - Cache name (defaults to filename)
   * @returns {Promise<string>} Font name
   */
  async loadFont(url, name) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load font: ${url}`);
    const buf = new Uint8Array(await resp.arrayBuffer());

    // Validate header
    if (buf.length < 8 ||
        buf[0] !== 0x42 || buf[1] !== 0x4D || buf[2] !== 0x46 || // "BMF"
        buf[3] !== 0 ||    // version
        buf[4] !== 8 ||    // px
        buf[5] !== 8 ||    // py
        (buf[6] | (buf[7] << 8)) !== 256) { // glyphs LE
      throw new Error(`Invalid BMF file: ${url}`);
    }

    if (buf.length < 2056) {
      throw new Error(`BMF file too small: ${url} (${buf.length} bytes, need 2056)`);
    }

    const fontName = name || url.split('/').pop().replace('.bmf', '');
    this.fonts[fontName] = buf.subarray(8, 8 + 2048);
    if (!this.defaultFont) this.defaultFont = fontName;
    return fontName;
  }

  /**
   * Parse a CSS color string to [r, g, b, a]
   */
  _parseColor(color) {
    if (Array.isArray(color)) return color;
    if (!color) return [255, 255, 255, 255];

    // Use offscreen canvas to parse CSS colors
    if (!this._colorCtx) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      this._colorCtx = c.getContext('2d');
    }
    this._colorCtx.fillStyle = color;
    this._colorCtx.fillRect(0, 0, 1, 1);
    const d = this._colorCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  /**
   * Get interpolated gradient color for a scanline
   */
  _getGradientColor(scanline, totalHeight, palette, offset) {
    if (palette.length === 0) return [255, 255, 255, 255];
    if (palette.length === 1) return palette[0];

    const normalizedY = scanline / Math.max(1, totalHeight - 1);
    let palettePos = normalizedY * (palette.length - 1) + offset;

    // Wrap around
    while (palettePos < 0) palettePos += palette.length;
    palettePos = palettePos % palette.length;

    const indexA = Math.floor(palettePos);
    const indexB = (indexA + 1) % palette.length;
    const frac = palettePos - indexA;

    const a = palette[indexA];
    const b = palette[indexB];
    return [
      Math.round(a[0] + (b[0] - a[0]) * frac),
      Math.round(a[1] + (b[1] - a[1]) * frac),
      Math.round(a[2] + (b[2] - a[2]) * frac),
      Math.round(a[3] + (b[3] - a[3]) * frac),
    ];
  }

  /**
   * Render a glyph into an ImageData pixel buffer
   */
  _renderGlyph(pixels, texW, texH, fontData, charCode, baseX, baseY, scaleX, scaleY, color) {
    const glyphOffset = charCode * 8;
    for (let row = 0; row < 8; row++) {
      const byte = fontData[glyphOffset + row];
      if (byte === 0) continue;
      for (let col = 0; col < 8; col++) {
        if (!(byte & (0x80 >> col))) continue;
        const px0 = baseX + col * scaleX;
        const py0 = baseY + row * scaleY;
        for (let sy = 0; sy < scaleY; sy++) {
          const py = py0 + sy;
          if (py < 0 || py >= texH) continue;
          for (let sx = 0; sx < scaleX; sx++) {
            const px = px0 + sx;
            if (px < 0 || px >= texW) continue;
            const idx = (py * texW + px) * 4;
            pixels[idx] = color[0];
            pixels[idx + 1] = color[1];
            pixels[idx + 2] = color[2];
            pixels[idx + 3] = color[3];
          }
        }
      }
    }
  }

  /**
   * Render a glyph with per-scanline gradient colors
   */
  _renderGlyphGradient(pixels, texW, texH, fontData, charCode, baseX, baseY, scaleX, scaleY, palette, gradientOffset) {
    const glyphOffset = charCode * 8;
    for (let row = 0; row < 8; row++) {
      const byte = fontData[glyphOffset + row];
      if (byte === 0) continue;
      for (let col = 0; col < 8; col++) {
        if (!(byte & (0x80 >> col))) continue;
        const px0 = baseX + col * scaleX;
        const py0 = baseY + row * scaleY;
        for (let sy = 0; sy < scaleY; sy++) {
          const py = py0 + sy;
          if (py < 0 || py >= texH) continue;
          const color = this._getGradientColor(py, texH, palette, gradientOffset);
          for (let sx = 0; sx < scaleX; sx++) {
            const px = px0 + sx;
            if (px < 0 || px >= texW) continue;
            const idx = (py * texW + px) * 4;
            pixels[idx] = color[0];
            pixels[idx + 1] = color[1];
            pixels[idx + 2] = color[2];
            pixels[idx + 3] = color[3];
          }
        }
      }
    }
  }

  /**
   * Measure text dimensions in pixels
   */
  measureText(text, options = {}) {
    const scaleX = options.scaleX || 1;
    const scaleY = options.scaleY || 1;
    const shadow = options.shadow || null;
    const outline = options.outline || null;

    let extraX = 0, extraY = 0;
    if (shadow) {
      extraX = Math.abs(shadow.offsetX || 1) * scaleX;
      extraY = Math.abs(shadow.offsetY || 1) * scaleY;
    }
    if (outline) {
      const t = (outline.thickness || 1) * scaleX;
      extraX = Math.max(extraX, t * 2);
      extraY = Math.max(extraY, (outline.thickness || 1) * scaleY * 2);
    }

    return {
      width: text.length * 8 * scaleX + extraX,
      height: 8 * scaleY + extraY
    };
  }

  /**
   * Draw text to canvas
   */
  drawText(text, x, y, options = {}) {
    const fontName = options.font || this.defaultFont;
    const fontData = this.fonts[fontName];
    if (!fontData) throw new Error(`Font not loaded: ${fontName}`);

    const scaleX = options.scaleX || 1;
    const scaleY = options.scaleY || 1;
    const color = this._parseColor(options.color || '#ffffff');
    const bgColor = options.backgroundColor ? this._parseColor(options.backgroundColor) : null;
    const shadow = options.shadow || null;
    const outline = options.outline || null;
    const gradient = options.gradient || null;

    // Calculate extra space for effects
    let outlineT = 0;
    if (outline) outlineT = outline.thickness || 1;
    const shadowOffX = shadow ? (shadow.offsetX || 1) : 0;
    const shadowOffY = shadow ? (shadow.offsetY || 1) : 0;
    const shadowExtraX = shadow ? Math.abs(shadowOffX) * scaleX : 0;
    const shadowExtraY = shadow ? Math.abs(shadowOffY) * scaleY : 0;
    const outlineExtraX = outlineT * scaleX;
    const outlineExtraY = outlineT * scaleY;
    const extraX = Math.max(shadowExtraX, outlineExtraX * 2);
    const extraY = Math.max(shadowExtraY, outlineExtraY * 2);

    const texW = text.length * 8 * scaleX + extraX;
    const texH = 8 * scaleY + extraY;

    if (texW <= 0 || texH <= 0) return;

    const imgData = this.ctx.createImageData(texW, texH);
    const pixels = imgData.data;

    // Fill background
    if (bgColor) {
      for (let i = 0; i < texW * texH; i++) {
        pixels[i * 4] = bgColor[0];
        pixels[i * 4 + 1] = bgColor[1];
        pixels[i * 4 + 2] = bgColor[2];
        pixels[i * 4 + 3] = bgColor[3];
      }
    }

    // Parse gradient palette if needed
    let parsedPalette = null;
    if (gradient && gradient.palette && gradient.palette.length >= 2) {
      parsedPalette = gradient.palette.map(c => this._parseColor(c));
    }

    // Base offset for outline padding
    const baseOffX = outlineT * scaleX;
    const baseOffY = outlineT * scaleY;

    // Outline neighbor offsets (8-directional)
    const outlineOffsets = [];
    if (outline) {
      const oc = this._parseColor(outline.color || '#000000');
      for (let oy = -outlineT; oy <= outlineT; oy++) {
        for (let ox = -outlineT; ox <= outlineT; ox++) {
          if (ox === 0 && oy === 0) continue;
          outlineOffsets.push({ ox: ox * scaleX, oy: oy * scaleY, color: oc });
        }
      }
    }

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) & 0xFF;
      const charBaseX = i * 8 * scaleX + baseOffX;
      const charBaseY = baseOffY;

      // 1. Render outline (underneath everything)
      for (const off of outlineOffsets) {
        this._renderGlyph(pixels, texW, texH, fontData, charCode,
          charBaseX + off.ox, charBaseY + off.oy, scaleX, scaleY, off.color);
      }

      // 2. Render shadow
      if (shadow) {
        const sc = this._parseColor(shadow.color || '#000000');
        this._renderGlyph(pixels, texW, texH, fontData, charCode,
          charBaseX + shadowOffX * scaleX, charBaseY + shadowOffY * scaleY,
          scaleX, scaleY, sc);
      }

      // 3. Render foreground (with gradient or solid color)
      if (parsedPalette) {
        this._renderGlyphGradient(pixels, texW, texH, fontData, charCode,
          charBaseX, charBaseY, scaleX, scaleY, parsedPalette, gradient.offset || 0);
      } else {
        this._renderGlyph(pixels, texW, texH, fontData, charCode,
          charBaseX, charBaseY, scaleX, scaleY, color);
      }
    }

    this.ctx.putImageData(imgData, x, y);
  }

  /**
   * Clear the canvas
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Get list of loaded font names
   */
  getFontList() {
    return Object.keys(this.fonts);
  }
}

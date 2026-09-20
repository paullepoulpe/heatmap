// A Leaflet layer backed by one canvas that a draw callback repaints on move/zoom.
// Used for the fog and the street coverage, which are far too many shapes for SVG.

export function createCanvasLayer(draw, { pane = 'overlayPane', padding = 0.5, className = '' } = {}) {
  const Layer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', `leaflet-layer ${className}`);
      this._canvas.style.pointerEvents = 'none';
      map.getPane(pane).appendChild(this._canvas);
      map.on('moveend zoomend resize', this._reset, this);
      map.on('zoomanim', this._onZoomAnim, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      map.off('zoomanim', this._onZoomAnim, this);
      this._canvas.remove();
    },
    redraw() {
      if (this._map) this._reset();
      return this;
    },
    _onZoomAnim(e) {
      // scale the old picture during the zoom animation, like Leaflet's own canvas renderer
      const scale = this._map.getZoomScale(e.zoom, this._zoom);
      const offset = this._map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },
    _reset() {
      const map = this._map;
      const size = map.getSize();
      const pad = size.multiplyBy(padding);
      const min = map.containerPointToLayerPoint(pad.multiplyBy(-1));
      const full = size.multiplyBy(1 + padding * 2);
      const ratio = window.devicePixelRatio || 1;
      this._zoom = map.getZoom();
      this._bounds = L.latLngBounds(map.layerPointToLatLng(min), map.layerPointToLatLng(min.add(full)));
      L.DomUtil.setTransform(this._canvas, min, 1);
      this._canvas.width = Math.round(full.x * ratio);
      this._canvas.height = Math.round(full.y * ratio);
      this._canvas.style.width = `${full.x}px`;
      this._canvas.style.height = `${full.y}px`;
      const ctx = this._canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, full.x, full.y);
      const origin = min;
      const project = (lat, lng) => map.latLngToLayerPoint([lat, lng]).subtract(origin);
      draw(ctx, { map, project, width: full.x, height: full.y, bounds: this._bounds, zoom: this._zoom });
    },
  });
  return new Layer();
}

/** Metres per CSS pixel at a latitude and zoom. */
export function metersPerPixel(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

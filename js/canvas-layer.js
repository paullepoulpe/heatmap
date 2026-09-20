// A Leaflet layer backed by one canvas that a draw callback repaints on move/zoom.
// Used for the fog and the street coverage, which are far too many shapes for SVG.
//
// Follows the same event dance as Leaflet's own L.Canvas renderer: while a zoom
// is in progress (pinch, wheel or button) the existing picture is scaled with a
// CSS transform so it tracks the map, and it is repainted once the gesture ends.

const MAX_RATIO = 2; // 3x phones get a 2x overlay: half the pixels, no visible difference under blur/lines

export function createCanvasLayer(draw, { pane = 'overlayPane', padding = 0.25, className = '' } = {}) {
  const Layer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', `leaflet-layer ${className}`);
      this._canvas.style.pointerEvents = 'none';
      L.DomUtil.addClass(this._canvas, `leaflet-zoom-${this._zoomAnimated ? 'animated' : 'hide'}`);
      map.getPane(pane).appendChild(this._canvas);
      this._update();
    },
    onRemove() {
      this._canvas.remove();
    },
    getEvents() {
      const events = {
        viewreset: this._reset,
        zoom: this._onZoom,
        moveend: this._update,
        resize: this._update,
      };
      if (this._zoomAnimated) events.zoomanim = this._onAnimZoom;
      return events;
    },
    redraw() {
      if (this._map) this._update();
      return this;
    },
    _onAnimZoom(ev) {
      this._updateTransform(ev.center, ev.zoom);
    },
    _onZoom() {
      this._updateTransform(this._map.getCenter(), this._map.getZoom());
    },
    _reset() {
      this._update();
      this._updateTransform(this._center, this._zoom);
    },
    /** Scale and shift the last painted picture so it follows an in-progress zoom. */
    _updateTransform(center, zoom) {
      const map = this._map;
      if (!this._center) return;
      const scale = map.getZoomScale(zoom, this._zoom);
      const viewHalf = map.getSize().multiplyBy(0.5 + padding);
      const currentCenterPoint = map.project(this._center, zoom);
      const topLeftOffset = viewHalf.multiplyBy(-scale).add(currentCenterPoint).subtract(map._getNewPixelOrigin(center, zoom));
      if (L.Browser.any3d) L.DomUtil.setTransform(this._canvas, topLeftOffset, scale);
      else L.DomUtil.setPosition(this._canvas, topLeftOffset);
    },
    /** Full repaint for the current view (plus padding on every side). */
    _update() {
      const map = this._map;
      if (!map || (map._animatingZoom && this._bounds)) return;
      const size = map.getSize();
      const min = map.containerPointToLayerPoint(size.multiplyBy(-padding)).round();
      this._bounds = new L.Bounds(min, min.add(size.multiplyBy(1 + padding * 2)).round());
      this._center = map.getCenter();
      this._zoom = map.getZoom();

      const full = this._bounds.getSize();
      const ratio = Math.min(MAX_RATIO, window.devicePixelRatio || 1);
      const canvas = this._canvas;
      L.DomUtil.setPosition(canvas, min);
      canvas.width = Math.round(full.x * ratio);
      canvas.height = Math.round(full.y * ratio);
      canvas.style.width = `${full.x}px`;
      canvas.style.height = `${full.y}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, full.x, full.y);
      const project = (lat, lng) => map.latLngToLayerPoint([lat, lng]).subtract(min);
      const bounds = L.latLngBounds(map.layerPointToLatLng(min), map.layerPointToLatLng(this._bounds.max));
      draw(ctx, { map, project, width: full.x, height: full.y, bounds, zoom: this._zoom });
    },
  });
  return new Layer();
}

/** Metres per CSS pixel at a latitude and zoom. */
export function metersPerPixel(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

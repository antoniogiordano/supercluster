
import invariant from 'invariant';
import { screenDist2LatLngDist } from './utils/latLng';
import createTree from './utils/createTree';


const createCluster = (id, x, y, points) => ({
  x, // cluster center
  y,
  id,
  wx: x, // weighted cluster center
  wy: y,
  zoom: Infinity, // the last zoom the cluster was processed at
  points,
  numPoints: points.length,
});

// squared distance between two points
function distSq(a, b) {
  const dx = a.wx - b.wx;
  const dy = a.wy - b.wy;
  return dx * dx + dy * dy;
}

function SuperCluster(options) {
  this.options = {
    ...this.options,
    ...options,
  };

  this._initTrees();
}

SuperCluster.prototype = {
  options: {
    minZoom: 0, // min zoom to generate clusters on
    maxZoom: 16, // max zoom level to cluster the points on
    radius: 40, // cluster radius in pixels
    extent: 512, // tile extent (radius is calculated relative to it)
    nodeSize: 16, // size of the R-tree leaf node, affects performance
  },

  load(points) {
    // generate a cluster object for each point
    let clusters = points.map(
      ({ ...pt, lat, lng, id }) => createCluster(id, lng, lat, [pt])
    );

    // cluster points on max zoom, then cluster the results on previous zoom, etc.;
    // results in a cluster hierarchy across zoom levels
    for (let z = this.options.maxZoom; z >= this.options.minZoom; z--) {
      this.trees[z + 1].load(clusters); // index input points into an R-tree
      clusters = this._cluster(clusters, z); // create a new set of clusters for the zoom
    }
    this.trees[this.options.minZoom].load(clusters); // index top-level clusters

    return this;
  },

  getClusters(bbox, zoom) {
    const [nwLng, seLat, seLng, nwLat] = bbox;
    const z = Math.max(this.options.minZoom, Math.min(zoom, this.options.maxZoom + 1));
    const bBoxes = nwLng < seLng
      ? [bbox]
      : [[nwLng, seLat, 180, nwLat], [-180, seLat, seLng, nwLat]];

    const clusters = bBoxes
      .map((bBox) => this.trees[z].search(bBox))
      .reduce((r, lst) => [...r, ...lst], []);

    return clusters;
  },

  _initTrees() {
    this.trees = [];
    // make an R-Tree index for each zoom level
    for (let z = 0; z <= this.options.maxZoom + 1; z++) {
      this.trees[z] = createTree(this.options.nodeSize);
    }
  },

  _cluster(points, zoom) {
    const clusters = [];
    const r = screenDist2LatLngDist(this.options.radius, zoom);
    const bbox = [0, 0, 0, 0];

    // loop through each point
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let clusterPoints = p.points;
      // if we've already visited the point at this zoom level, skip it
      if (p.zoom <= zoom) continue;
      p.zoom = zoom;

      // find all nearby points with a bbox search
      bbox[0] = p.wx - r;
      bbox[1] = p.wy - r;
      bbox[2] = p.wx + r;
      bbox[3] = p.wy + r;
      const bboxNeighbors = this.trees[zoom + 1].search(bbox);

      let foundNeighbors = false;
      let numPoints = p.numPoints;
      let wx = p.wx * numPoints;
      let wy = p.wy * numPoints;

      for (let j = 0; j < bboxNeighbors.length; j++) {
        const b = bboxNeighbors[j];
        // filter out neighbors that are too far or already processed
        if (zoom < b.zoom && distSq(p, b) <= r * r) {
          foundNeighbors = true;
          b.zoom = zoom; // save the zoom (so it doesn't get processed twice)
          wx += b.wx * b.numPoints; // accumulate coordinates for calculating weighted center
          wy += b.wy * b.numPoints;
          numPoints += b.numPoints;
          clusterPoints = [...clusterPoints, ...b.points];
        }
      }

      if (!foundNeighbors) {
        clusters.push(p); // no neighbors, add a single point as cluster
        continue;
      }

      // form a cluster with neighbors
      const cluster = createCluster(p.id, p.x, p.y, clusterPoints);
      invariant(clusterPoints.length === numPoints, 'clusterPoints.length === numPoints');

      // save weighted cluster center for display
      cluster.wx = wx / numPoints;
      cluster.wy = wy / numPoints;

      clusters.push(cluster);
    }

    return clusters;
  },
};

const supercluster = (points, options) => {
  const cl = new SuperCluster(options);
  cl.load(points);

  return ({ bounds: { nw, se }, zoom }) => cl.getClusters(
    [nw.lng, se.lat, se.lng, nw.lat],
    zoom
  );
};

export default supercluster;

/*
const cl = supercluster([
  { lat: 10, lng: 10 },
  { lat: 10.1, lng: 10.1 },
  { lat: 12, lng: 12 },
  { lat: 84, lng: 179 },
]);

const r = cl({ bounds: { nw: { lat: 85, lng: -180 }, se: { lat: -85, lng: 180 } }, zoom: 2 });

console.log(JSON.stringify(r));
*/

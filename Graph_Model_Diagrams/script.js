// Globals to track current data and toggle state
window.useDkAfter = false;
let currentNodes = [];
let currentLinks = [];

// SVG layout constants
const MAX_SVG_W = 1750;
const BASE_SVG_H = 1200;
const PAD_T = 20, PAD_R = 250, PAD_B = 20, PAD_L = 300;
const TOP_OFFSET = 100;

// Tooltip setup
const tooltip = d3.select('body')
  .append('div')
  .attr('class', 'tooltip')
  .style('position', 'absolute')
  .style('background', 'rgba(255,255,255,0.9)')
  .style('padding', '6px')
  .style('border', '1px solid #ccc')
  .style('border-radius', '4px')
  .style('pointer-events', 'none')
  .style('opacity', 0);

// Compute SVG dimensions
function getSvgDims() {
  const w = Math.min(MAX_SVG_W, window.innerWidth - 20);
  return { w, h: BASE_SVG_H };
}

// Main render function
export function renderGraph(rawNodes, rawLinks) {
  currentNodes = rawNodes;
  currentLinks = rawLinks;

  const { w: SVG_W, h: SVG_H } = getSvgDims();
  const svg = d3.select('#graph-container').html('')
    .append('svg')
      .attr('width', SVG_W)
      .attr('height', SVG_H)
      .style('margin', `${TOP_OFFSET}px auto 0`)
      .attr('viewBox', `0 0 ${SVG_W} ${SVG_H}`)
    .append('g');

  // arrowhead marker
  const defs = svg.append('defs');

defs.append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 8)                // push the arrow tip just beyond the end of your path
    .attr('refY', 0)
    .attr('orient', 'auto')         // rotate to match path direction
    .attr('markerUnits', 'strokeWidth') // scales marker size with stroke width
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
  .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')  // classic triangle
    .attr('fill', 'currentColor');

  // Layout + render
  const layout = sugiyamaLayout(rawNodes, rawLinks);
  plotLinks(layout, svg);
  plotNodes(layout.nodes, svg);
  addLegends(svg, SVG_W);

  // Resizing
  window.addEventListener('resize', () => renderGraph(currentNodes, currentLinks));
}

// Sugiyama layout
function sugiyamaLayout(rawNodes, rawLinks) {
  // clone so we don’t mutate the user’s arrays in place
  const nodes = rawNodes.map(n => ({ ...n }));
  const links = rawLinks.map(l => ({ ...l }));

  // 1. Build Dagre graph
  const g = new dagre.graphlib.Graph()
    .setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 100 })
    .setDefaultEdgeLabel(() => ({}));

  // 2. Add nodes (force string keys, trimmed)
  nodes.forEach(n => {
    n._key = String(n.id).trim();
    g.setNode(n._key, { width: 40, height: 40 });
  });

  // 3. Add edges
  links.forEach(l => {
    l._src = String(l.source).trim();
    l._tgt = String(l.target).trim();
    g.setEdge(l._src, l._tgt);
  });

  // 4. Run layout
  dagre.layout(g);

  // 5. Build scales once
  const { w: SVG_W } = getSvgDims();
  const { width: gW, height: gH } = g.graph();
  const xScale = d3.scaleLinear().domain([0, gW]).range([PAD_L, SVG_W - PAD_R]);
  const yScale = d3.scaleLinear().domain([0, gH]).range([PAD_T, BASE_SVG_H - PAD_B]);

  // 6. Assign x/y to each node
  nodes.forEach(n => {
    const p = g.node(n._key);
    if (!p) {
      console.error(`Missing layout for node ${n.id}`, g.nodes());
      n.x = PAD_L; n.y = PAD_T;
    } else {
      n.x = xScale(p.x);
      n.y = yScale(p.y);
    }
  });

  // 7. Compute and attach a scaled `points` array to each link
  links.forEach(l => {
    const e = g.edge(l._src, l._tgt);
    if (!e) {
      console.error(`Missing edge routing for ${l.source}→${l.target}`, g.edges());
      l.points = [ {x:PAD_L, y:PAD_T}, {x:PAD_L+10, y:PAD_T+10} ];
    } else {
      l.points = e.points.map(pt => ({
        x: xScale(pt.x),
        y: yScale(pt.y)
      }));
    }
  });

  return { nodes, links };
}


// Plot nodes
function plotNodes(nodes, svg) {
  // Scales
    const occExtent = d3.extent(nodes, d => d.KO_Occurrence);
    const rScale = d3.scaleLinear().domain(occExtent).range([5,20]);
    const occScale = d3.scaleSequential(t => d3.interpolateGreys(0.3 + 0.8 * t)).domain(occExtent);
    // Brightened blue: sample the top 80% of the palette
    const dkScale = d3.scaleSequential(d3.interpolateReds).domain([0,1]);
    const evScale = d3.scaleSequential()
    .domain([-50, 0])
    .interpolator(d3.interpolateRgb("#ff0000","white"))
    .clamp(true);
  
  
  const nodeG = svg.append('g').attr('class','nodes');

  nodeG.selectAll('g.node').data(nodes).enter().append('g')
    .attr('class','node')
    .attr('transform', d=>`translate(${d.x},${d.y})`)
    .each(function(d) {
      const g = d3.select(this);
      const r = rScale(d.KO_Occurrence);

      if (d.Dk_before == null) {
        g.append('circle')
         .attr('r', r)
         .attr('fill', occScale(d.KO_Occurrence))
         .attr('stroke','black')
         .attr('stroke-width',1);
      } else {
        // Blue half
        g.append('path')
         .attr('d', d3.arc().innerRadius(0).outerRadius(r)({
           startAngle:-Math.PI/2, endAngle:Math.PI/2
         }))
         .attr('fill', dkScale(window.useDkAfter ? d.Dk_after : d.Dk_before));

        // Red half
        const ev = d['E-value'];
        const t  = Math.log10(ev);
        const fillColor = (isFinite(t) ? evScale(t) : "#888888");
        
        g.append('path')
          .attr('d', d3.arc().innerRadius(0).outerRadius(r)({
            startAngle:  Math.PI/2,
            endAngle:    3*Math.PI/2
          }))
          .attr('fill', fillColor);

        // Draw a thin black line dividing the halves
        g.append('line')
        .attr('x1', -r).attr('y1', 0)
        .attr('x2', r).attr('y2', 0)
        .attr('stroke', 'black')
        .attr('stroke-width', 1);

        // Draw an outline circle
        g.append('circle')
        .attr('r', r)
        .attr('fill','none')
        .attr('stroke','black')
        .attr('stroke-width',1);
       
      }

      g.append('text')
      .text(d.id.replace(/_[0-9]+$/, ''))   // strip trailing “_1”
      .attr('text-anchor', 'middle')
      .attr('y', r + 14)
      .attr('font-size', '12px')
      .attr('fill', '#000')
      .attr('pointer-events', 'none');

      // Tooltip events
      g.on('mouseover', (event) => {
        tooltip.transition().duration(200).style('opacity', 0.98);
        tooltip.html(`KO: ${d.id.replace(/_[0-9]+$/, '')}<br/>Dk_before: ${d.Dk_before}<br/>Dk_after: ${d.Dk_after}<br/>E-value: ${d['E-value']}`)
          .style('left', (event.pageX + 5) + 'px')
          .style('top',  (event.pageY - 28) + 'px');
      })
      .on('mouseout', () => {
        tooltip.transition().duration(500).style('opacity', 0);
      });
    });
}

// Plot links
function plotLinks({ links }, svg) {
  const occExtent  = d3.extent(links, d => d.edge_occurence);
  const colorScale = d3.scaleSequential(t => d3.interpolateGreys(0.5 + 0.8*t)).domain(occExtent);
  const widthScale = d3.scaleLinear().domain(occExtent).range([1,3]);

  const linkG = svg.append('g').attr('class','links');

  linkG.selectAll('path')
    .data(links)
    .enter().append('path')
      .attr('d', d => {
        // If you prefer straight cornered edges, switch to curveStep
        return d3.line()
          .x(p => p.x)
          .y(p => p.y)
          .curve(d3.curveBasis)(d.points);
      })
      .attr('fill','none')
      .attr('stroke', d => colorScale(d.edge_occurence))
      .attr('stroke-width', d => widthScale(d.edge_occurence))
      .attr('marker-end','url(#arrowhead)')
      .on('mouseover', (evt,d) => {
        tooltip.transition().duration(200).style('opacity',0.9)
               .html(`Edge Occurrence: ${d.edge_occurence}`)
               .style('left',`${evt.pageX+5}px`)
               .style('top',`${evt.pageY-28}px`);
      })
      .on('mouseout', () => tooltip.transition().duration(500).style('opacity',0));
}




// Legends for color scales
function addLegends(svg, SVG_W) {
    const legendX = SVG_W - PAD_R + 20;
    const legendY = 20;
    const barW    = 20;
    const barH    = 100;
    const spacing = 30;
  
    // Re-create the same scales you use in plotNodes():
    const dkScale = d3.scaleSequential()
    .domain([0, 1])
    .interpolator(d3.interpolateCubehelix("white", "darkred"));
  
    const evScale = d3.scaleSequential()
      .domain([-50, 0])             // log₁₀(E-value) from –50 → 0
      .interpolator(d3.interpolateRgb("white", "#ff0000"))
      .clamp(true);
  
    const defs = svg.append("defs");
  
    // Dk gradient (dark red → purple-ish → white)
    defs.append("linearGradient")
    .attr("id", "dkGradient")
    .attr("x1", "0%").attr("y1", "100%")
    .attr("x2", "0%").attr("y2", "0%")
    .call(g => {
      g.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", dkScale(0));  // white
      g.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", dkScale(1));  // dark red
    });
    // E-value gradient (white → bright red)
    defs.append("linearGradient")
      .attr("id", "evGradient")
      .attr("x1", "0%").attr("y1", "0%")
      .attr("x2", "0%").attr("y2", "100%")
      .call(g => {
        g.append("stop")
          .attr("offset", "0%")
          .attr("stop-color", evScale(0));   // white (log10(E)=0)
        g.append("stop")
          .attr("offset", "100%")
          .attr("stop-color", evScale(-50)); // bright red (log10(E)=–50)
      });
  
    const legend = svg.append("g")
      .attr("transform", `translate(${legendX},${legendY})`);
  
    legend.append("text")
      .attr("x", 0).attr("y", 0)
      .attr("font-size", 14)
      .text("Color Scales");
  
    // Dk bar + axis
    legend.append("rect")
      .attr("x", 0).attr("y", 20)
      .attr("width", barW).attr("height", barH)
      .attr("fill", "url(#dkGradient)");
  
    const dkAxisScale = d3.scaleLinear()
      .domain([0, 1])
      .range([20 + barH, 20]);
  
    legend.append("g")
      .attr("transform", `translate(${barW}, 0)`)
      .call(d3.axisRight(dkAxisScale).ticks(3).tickSize(4))
      .selectAll("text").attr("font-size", 10);
  
    legend.append("text")
      .attr("x", 0).attr("y", 14)
      .attr("font-size", 10)
      .text("Dk");
  
    // E-value bar + axis
    const evY = 20 + barH + spacing;
    legend.append("rect")
      .attr("x", 0).attr("y", evY)
      .attr("width", barW).attr("height", barH)
      .attr("fill", "url(#evGradient)");
  
    const evAxisScale = d3.scaleLinear()
      .domain([0, -50])               // 0 (white) at bottom, –50 (red) at top
      .range([evY + barH, evY])
      .clamp(true);
  
    legend.append("g")
      .attr("transform", `translate(${barW}, 0)`)
      .call(
        d3.axisRight(evAxisScale)
          .tickValues([0, -25, -50])
          .tickFormat(d => `1e${d}`)
          .tickSize(4)
      )
      .selectAll("text").attr("font-size", 10);
  
    legend.append("text")
      .attr("x", 0).attr("y", evY - 6)
      .attr("font-size", 10)
      .text("E-value");
  }
  


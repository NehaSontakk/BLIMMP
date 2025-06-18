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
export function renderGraph(nodes, links) {
  currentNodes = nodes;
  currentLinks = links;

  // Clear container
  const { w: SVG_W, h: SVG_H } = getSvgDims();
  d3.select('#graph-container').html('');

  const svg = d3.select('#graph-container')
    .append('svg')
    .attr('width', SVG_W)
    .attr('height', SVG_H)
    .style('margin', `${TOP_OFFSET}px auto 0`)
    .attr('viewBox', `0 0 ${SVG_W} ${SVG_H}`)
    .append('g');

  // Arrow marker definition
  svg.append('defs').append('marker')
    .attr('id','arrowhead')
    .attr('viewBox','-0 -5 10 10')
    .attr('refX',35)
    .attr('refY',0)
    .attr('orient','auto')
    .attr('markerWidth',4)
    .attr('markerHeight',4)
    .append('path')
    .attr('d','M 0,-5 L 10,0 L 0,5')
    .attr('fill','currentColor');

  // Layout nodes
  const { nodes: layNodes, links: layLinks } = sugiyamaLayout(nodes, links);

  // Plot order: links below nodes
  plotLinks(layLinks, svg);
  plotNodes(layNodes, svg);
  addLegends(svg, SVG_W);

  // Redraw on resize
  window.addEventListener('resize', () => renderGraph(currentNodes, currentLinks));
}

// Sugiyama layout
function sugiyamaLayout(nodes, links) {
  const g = new dagre.graphlib.Graph().setGraph({ rankdir:'TB', nodesep:20, ranksep:50 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach(n => g.setNode(n.id, { width:40, height:40 }));
  links.forEach(l => g.setEdge(l.source, l.target));
  dagre.layout(g);

  const { w: SVG_W } = getSvgDims();
  const { width: gW, height: gH } = g.graph();
  const xScale = d3.scaleLinear().domain([0, gW]).range([PAD_L, SVG_W - PAD_R]);
  const yScale = d3.scaleLinear().domain([0, gH]).range([PAD_T, BASE_SVG_H - PAD_B]);

  nodes.forEach(n => {
    const p = g.node(n.id);
    n.x = xScale(p.x);
    n.y = yScale(p.y);
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

    g.append('text')
      .text(d.id)                     // KO number
      .attr('text-anchor', 'middle')  // center horizontally
      .attr('y', -r - 4)              // float just above the top edge; adjust “4” px padding as needed
      .attr('font-size', '12px')      // fixed size for all labels
      .attr('fill', '#000')           // color for contrast
      .attr('font-weight','bold')
      .attr('pointer-events', 'none'); // so it doesn’t block hover on the circle
       
      }

      // Tooltip events
      g.on('mouseover', (event) => {
        tooltip.transition().duration(200).style('opacity', 0.9);
        tooltip.html(`KO: ${d.id}<br/>Dk_before: ${d.Dk_before}<br/>Dk_after: ${d.Dk_after}<br/>E-value: ${d['E-value']}`)
          .style('left', (event.pageX + 5) + 'px')
          .style('top',  (event.pageY - 28) + 'px');
      })
      .on('mouseout', () => {
        tooltip.transition().duration(500).style('opacity', 0);
      });
    });
}

// Plot links
function plotLinks(links, svg) {
  const nodeById = new Map(currentNodes.map(d => [d.id, d]));
  const occExtent = d3.extent(links, d => d.edge_occurence);
  const colorScale = d3.scaleSequential(t => d3.interpolateGreys(0.5 + 0.8*t)).domain(occExtent);
  const widthScale = d3.scaleLinear().domain(occExtent).range([1,3]);

  const linkG = svg.append('g').attr('class','links');
  linkG.selectAll('line').data(links).enter().append('line')
    .attr('x1', d => nodeById.get(d.source).x)
    .attr('y1', d => nodeById.get(d.source).y)
    .attr('x2', d => nodeById.get(d.target).x)
    .attr('y2', d => nodeById.get(d.target).y)
    .attr('stroke', d => colorScale(d.edge_occurence))
    .attr('stroke-width', d => widthScale(d.edge_occurence))
    .attr('marker-end','url(#arrowhead)');
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
  



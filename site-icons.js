const svgNamespace='http://www.w3.org/2000/svg';
export function createIcon(name,className='') {
  const svg=document.createElementNS(svgNamespace,'svg'),use=document.createElementNS(svgNamespace,'use');
  svg.setAttribute('viewBox','0 0 256 256');svg.setAttribute('class',`site-icon ${className}`.trim());svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  use.setAttribute('href',`/site-icons.svg?v=3#${name}`);svg.append(use);return svg;
}
export function setIconLabel(node,label,name) {const text=document.createElement('span');text.textContent=label;node.replaceChildren(createIcon(name),text);}
const charms=['bow','paw-print','bell-ringing','dress','ribbon','heart'];
export function decorateCard(card,index=0) {
  if(card.querySelector('.card__charm'))return;
  const charm=document.createElement('span');charm.className='card__charm';charm.setAttribute('aria-hidden','true');charm.append(createIcon(charms[index%charms.length]));card.append(charm);
}

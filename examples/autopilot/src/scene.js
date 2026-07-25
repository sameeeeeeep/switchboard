let _sid=0;
function sceneSVG(){const u='s'+(++_sid);return `<svg class="base" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice"><defs>
<linearGradient id="sky-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070C16"/>
<stop offset=".18" stop-color="#132038"/><stop offset=".34" stop-color="#1E3350"/>
<stop offset=".48" stop-color="#40415A"/><stop offset=".60" stop-color="#7A4A47"/>
<stop offset=".70" stop-color="#C4703C"/><stop offset=".78" stop-color="#E9954A"/>
<stop offset=".84" stop-color="#FFD79B"/><stop offset="1" stop-color="#FFE9C4"/></linearGradient>
<linearGradient id="rim-${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E9954A" stop-opacity=".04"/>
<stop offset=".28" stop-color="#E9954A" stop-opacity=".34"/><stop offset=".51" stop-color="#FFE7BE" stop-opacity="1"/>
<stop offset=".74" stop-color="#FFC582" stop-opacity=".62"/><stop offset="1" stop-color="#E9954A" stop-opacity=".12"/></linearGradient>
<radialGradient id="sun-${u}"><stop offset="0" stop-color="#FFF3D6"/>
<stop offset=".4" stop-color="#FFC97E" stop-opacity=".7"/><stop offset="1" stop-color="#E9954A" stop-opacity="0"/></radialGradient>
<filter id="bf-${u}"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="bs-${u}"><feGaussianBlur stdDeviation="2.6"/></filter>
<filter id="bm-${u}"><feGaussianBlur stdDeviation="1.3"/></filter>
<filter id="bg-${u}"><feGaussianBlur stdDeviation="22"/></filter></defs>
<rect width="1000" height="1000" fill="url(#sky-${u})"/>
<g fill="#fff"><circle cx="120" cy="70" r="1.8" opacity=".55"/><circle cx="300" cy="42" r="1.4" opacity=".42"/>
<circle cx="480" cy="96" r="1.6" opacity=".34"/><circle cx="700" cy="58" r="1.5" opacity=".28"/>
<circle cx="860" cy="120" r="1.7" opacity=".2"/><circle cx="210" cy="160" r="1.3" opacity=".22"/></g>
<ellipse cx="512" cy="616" rx="300" ry="150" fill="url(#sun-${u})" filter="url(#bf-${u})"/>
<circle cx="512" cy="606" r="30" fill="#FFF6E2" filter="url(#bf-${u})" opacity=".9"/>
<path d="M0,600 L90,556 L170,588 L260,530 L340,572 L430,516 L520,560 L610,520 L700,566 L790,530 L880,572 L1000,540 L1000,700 L0,700Z" fill="#5B7391" opacity=".34" filter="url(#bs-${u})"/>
<rect x="0" y="560" width="1000" height="120" fill="url(#sun-${u})" opacity=".5" style="mix-blend-mode:screen"/>
<path d="M0,676 L110,634 L200,664 L300,608 L400,650 L500,600 L600,646 L700,606 L800,652 L900,616 L1000,650 L1000,800 L0,800Z" fill="#28323C" opacity=".9" filter="url(#bm-${u})"/>
<ellipse cx="300" cy="712" rx="330" ry="46" fill="#E9B37A" opacity=".3" filter="url(#bg-${u})" style="mix-blend-mode:screen"/>
<ellipse cx="760" cy="726" rx="290" ry="40" fill="#E9954A" opacity=".26" filter="url(#bg-${u})" style="mix-blend-mode:screen"/>
<path d="M-4,764 L60,742 L130,756 C200,704 250,664 310,648 C370,634 420,654 470,694 L540,734 L610,716 L690,756 L770,738 L860,776 L940,756 L1004,784" fill="none" stroke="url(#rim-${u})" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" opacity=".8" stroke-dasharray="132 22 54 40 186 18 76 52 148 26 96 34"/>
<path d="M-4,1010 L-4,768 L60,746 L130,760 C200,708 250,668 310,652 C370,638 420,658 470,698 L540,738 L610,720 L690,760 L770,742 L860,780 L940,760 L1004,788 L1004,1010 Z" fill="#0D110F"/>
<path d="M310,652 C370,638 420,658 470,698 L430,790 L330,760 Z" fill="#141A16" opacity=".45"/>
<g transform="translate(672,772)"><ellipse cx="104" cy="214" rx="104" ry="18" fill="#000" opacity=".55"/>
<path d="M26,34 L36,196 Q40,214 104,214 Q168,214 172,196 L182,34 Z" fill="#0F1310"/>
<path d="M172,66 q52,6 50,52 q-2,44 -52,44" fill="none" stroke="#0F1310" stroke-width="21" stroke-linecap="round"/>
<ellipse cx="104" cy="34" rx="80" ry="21" fill="#0A0D0A"/>
<ellipse cx="104" cy="34" rx="80" ry="21" fill="none" stroke="#141814" stroke-width="7"/>
<ellipse cx="104" cy="36" rx="66" ry="16" fill="#2A1A10"/>
<ellipse cx="104" cy="35" rx="66" ry="16" fill="url(#sun-${u})" opacity=".55"/>
<path d="M26,34 L36,196" fill="none" stroke="#FFD9A0" stroke-width="3.4" opacity=".55" stroke-linecap="round"/>
<path d="M40,20 A80,21 0 0,1 150,18" fill="none" stroke="#FFE7BE" stroke-width="2.4" opacity=".6" stroke-linecap="round"/></g></svg>`;}
const FINISH=`<svg class="grain"><filter id="ga"><feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves="4" stitchTiles="stitch" seed="9"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#ga)"/></svg>
<svg class="grain2"><filter id="gb"><feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="2" stitchTiles="stitch" seed="3"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#gb)"/></svg>
<div class="gradeCool"></div><div class="gradeWarm"></div><div class="halation"></div><div class="vig"></div><div class="scrim"></div>`;
const STEAM=`<svg class="steam" viewBox="0 0 100 140" preserveAspectRatio="none"><path d="M28,132 C18,100 46,86 32,54 C22,32 40,18 36,4"/><path d="M54,136 C44,104 72,90 58,58 C48,36 66,22 62,8"/><path d="M78,132 C68,102 92,88 80,60 C72,40 86,26 84,12"/></svg>`;
const tinHTML=(w=148)=>`<div class="tin" style="--tw:${w}px"><div class="tin-body"><div class="tin-print"><div class="tin-mark">FIRSTLIGHT</div><div class="tin-sub">SINGLE ORIGIN · 40g</div><div class="tin-rule"></div></div><div class="tin-shade"></div></div><div class="tin-lid"></div><div class="tin-floor"></div></div>`;
const adScene=(a,fs)=>`<div class="adscene">${sceneSVG()}${STEAM}${FINISH}<div class="adcopy"><h3${fs?` style="font-size:${fs}px"`:''}>${a.head}</h3></div></div>`;


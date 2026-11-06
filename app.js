"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const DEFAULT = {
    bases: ["#3457D5", "#F2A93B", "#D65A83"],
    harmony: "integrated",
    count: 6
  };
  const STORAGE = "itten.project.v1";
  const PROJECTS_KEY = "itten.projects.v2";
  const ACTIVE_KEY = "itten.active.v2";
  const THEME = "itten.theme.v1";
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const MATRICES = {
    protanopia: [
      [.56667,.43333,0],
      [.55833,.44167,0],
      [0,.24167,.75833]
    ],
    deuteranopia: [
      [.625,.375,0],
      [.70,.30,0],
      [0,.30,.70]
    ],
    tritanopia: [
      [.95,.05,0],
      [0,.43333,.56667],
      [0,.475,.525]
    ]
  };

  let state = structuredDefault();
  let projects = [];
  let activeId = null;
  let editingId = null;
  let palette = [];
  let extracted = [];
  let toastTimer;
  let gradients = {};
  let storageAvailable = true;

  function structuredDefault() {
    return { ...DEFAULT, bases: [...DEFAULT.bases] };
  }

  function validHex(s) {
    return typeof s === "string" &&
      /^#[0-9a-f]{6}$/i.test(s);
  }

  function normalizeHex(s) {
    if (typeof s !== "string") return null;
    s = s.trim().toUpperCase();
    if (/^#[0-9A-F]{3}$/.test(s)) {
      s = "#" + [...s.slice(1)].map(c => c+c).join("");
    }
    return validHex(s) ? s : null;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1),16);
    return [(n >> 16)&255, (n >> 8)&255, n&255];
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map(n =>
      Math.round(Math.max(0,Math.min(255,n)))
        .toString(16).padStart(2,"0")
    ).join("").toUpperCase();
  }

  function clamp(n,min,max) {
    return Math.max(min,Math.min(max,n));
  }

  function rgbToHsl(hex) {
    const [r,g,b] = hexToRgb(hex).map(v=>v/255);
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const d=max-min;
    let h=0,s=0;
    const l=(max+min)/2;
    if (d) {
      s=d/(1-Math.abs(2*l-1));
      switch(max) {
        case r: h=((g-b)/d)%6; break;
        case g: h=(b-r)/d+2; break;
        default: h=(r-g)/d+4;
      }
      h*=60;
    }
    return [((h%360)+360)%360,s*100,l*100];
  }

  function hslToHex(h,s,l) {
    h=((h%360)+360)%360;
    s=clamp(s,0,100)/100;
    l=clamp(l,0,100)/100;
    const c=(1-Math.abs(2*l-1))*s;
    const x=c*(1-Math.abs((h/60)%2-1));
    const m=l-c/2;
    let rgb;
    if(h<60) rgb=[c,x,0];
    else if(h<120) rgb=[x,c,0];
    else if(h<180) rgb=[0,c,x];
    else if(h<240) rgb=[0,x,c];
    else if(h<300) rgb=[x,0,c];
    else rgb=[c,0,x];
    return rgbToHex(rgb.map(v=>(v+m)*255));
  }

  // WCAG: linearização exata dos canais sRGB normalizados.
  // O limiar 0.04045 e os coeficientes são os da definição WCAG.
  function luminance(hex) {
    const [r,g,b]=hexToRgb(hex).map(v=>{
      const c=v/255;
      return c<=.04045 ? c/12.92 :
        ((c+.055)/1.055)**2.4;
    });
    return .2126*r+.7152*g+.0722*b;
  }

  function contrast(a,b) {
    const x=luminance(a),y=luminance(b);
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  }

  function readable(hex) {
    // Escolhe a maior razão de contraste entre preto e branco.
    return contrast(hex,"#000000")>=contrast(hex,"#FFFFFF")
      ? "#000000" : "#FFFFFF";
  }

  function bestText(bg,candidates) {
    return candidates.reduce((best,c)=>
      contrast(c,bg)>contrast(best,bg)?c:best
    );
  }

  function harmonyOffsets(type) {
    return {
      complementary:[0,180],
      analogous:[-30,0,30],
      triadic:[0,120,240],
      split:[0,150,210],
      tetradic:[0,60,180,240],
      monochromatic:[0]
    }[type] || [0];
  }

  function generatePalette() {
    const bases=state.bases;
    const count=state.count;
    const result=[];
    const seen=new Set();

    function add(hex) {
      if(!seen.has(hex)) {
        seen.add(hex);
        result.push(hex);
      }
    }

    if(state.harmony==="integrated") {
      bases.forEach(add);
      // Integração: três âncoras + suas rotações no círculo HSL.
      const offsets=[30,180,-30,120,-120,60,210,150,240];
      let k=0;
      while(result.length<count && k<60) {
        const base=bases[k%3];
        const [h,s,l]=rgbToHsl(base);
        const offset=offsets[Math.floor(k/3)%offsets.length];
        add(hslToHex(h+offset,s,l));
        k++;
      }
    } else {
      const offsets=harmonyOffsets(state.harmony);
      const [h,s,l]=rgbToHsl(bases[0]);
      // Repetir ângulos com variações de luminosidade permite

      // gerar quantidades maiores que o número de matizes.
      const levels=[0,-14,14,-28,28,-40,40];
      for(const delta of levels) {
        for(const offset of offsets) {
          add(hslToHex(h+offset,s,clamp(l+delta,12,88)));
          if(result.length>=count) break;
        }
        if(result.length>=count) break;
      }
    }

    // Complementação determinística em caso de cores repetidas.
    let step=0;
    while(result.length<count && step<500) {
      const [h,s,l]=rgbToHsl(bases[step%3]);
      add(hslToHex(h+step*137.508,
        clamp(s+(step%5)*3,15,95),
        20+(step*13)%65));
      step++;
    }
    return result.slice(0,count);
  }

  function toast(message) {
    const el=$("toast");
    el.textContent=message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove("show"),2300);
  }

  async function copy(text) {
    try {
      if(navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback para navegadores sem Clipboard API.
        const area=document.createElement("textarea");
        area.value=text;
        area.style.position="fixed";
        area.style.opacity="0";
        document.body.append(area);
        area.select();
        const ok=document.execCommand("copy");
        area.remove();
        if(!ok) throw new Error("Cópia indisponível");
      }
      toast("Copiado para a área de transferência");
    } catch {
      toast("Não foi possível copiar neste navegador");
    }
  }

  function makeId(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  function projectName(){return projects.find(p=>p.id===activeId)?.name || "Projeto inicial";}
  function slugName(){return projectName().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,55)||"projeto";}
  function fileName(ext){return `${slugName()}-itten.${ext}`;}
  function save(){
    try {
      const p=projects.find(p=>p.id===activeId);
      if(p){p.data=JSON.parse(JSON.stringify(state));p.updated=new Date().toISOString();}
      localStorage.setItem(PROJECTS_KEY,JSON.stringify(projects));
      localStorage.setItem(ACTIVE_KEY,activeId);
      $("projectNameDisplay").textContent=projectName();
    }catch{storageAvailable=false;}
  }
  function uniqueName(name,exclude=null){return !projects.some(p=>p.id!==exclude && p.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"));}
  function addProject(name,data){
    const p={id:makeId(),name,updated:new Date().toISOString(),data:validateProject(data)};
    projects.push(p);activeId=p.id;state=JSON.parse(JSON.stringify(p.data));syncControls();save();return p;
  }
  function openProject(id){const p=projects.find(p=>p.id===id);if(!p)return;activeId=id;state=validateProject(p.data);syncControls();save();$("projectsDialog").close();toast(`Projeto aberto: ${p.name}`);}
  function renderProjects(){
    const list=$("projectsList");list.replaceChildren();
    for(const p of projects){
      const entry=document.createElement("div");entry.className="project-entry";
      const heading=document.createElement("div");const strong=document.createElement("strong");strong.textContent=p.name+(p.id===activeId?" · ativo":"");heading.append(strong);
      const small=document.createElement("small");small.textContent=`Atualizado: ${new Date(p.updated).toLocaleString("pt-BR")}`;heading.append(small);entry.append(heading);
      const actions=document.createElement("div");actions.className="project-actions";
      for(const [action,label] of [["open","Abrir"],["rename","Renomear"],["duplicate","Duplicar"],["delete","Excluir"]]){
        const btn=document.createElement("button");btn.type="button";btn.textContent=label;btn.dataset.action=action;btn.dataset.id=p.id;actions.append(btn);
      }
      entry.append(actions);list.append(entry);
    }
  }
  function openNameDialog(id=null){
    editingId=id;$("nameDialogTitle").textContent=id?"Renomear projeto":"Novo projeto";
    $("projectNameInput").value=id?(projects.find(p=>p.id===id)?.name||""):"";
    $("nameError").textContent="";$("nameDialog").showModal();$("projectNameInput").focus();
  }
  const REPORT_CSS = "@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}body{font-family:Arial,system-ui,sans-serif;background:#fff;color:#18283d;margin:0}.print-report{display:block!important;max-width:960px;margin:auto;padding:20px}.r-cover{background:#142a49;color:#fff;padding:28px 32px;border-radius:12px;margin-bottom:24px}.r-kicker{font-size:11px;letter-spacing:2px;color:#b6c8e6}.r-cover h1{font-size:29px;margin:12px 0}.r-cover p{color:#e2eaf7!important}.r-meta{display:flex;gap:16px;margin-top:24px}.r-meta>div{flex:1;border-top:1px solid #7990af;padding-top:12px}.r-meta small{display:block;color:#b8c8e0;font-size:10px;letter-spacing:1px}.r-meta b{display:block;font-size:13px;margin-top:5px}.r-section{margin:0 0 25px;break-inside:auto;page-break-inside:auto}.r-section h2{display:flex;align-items:center;gap:10px;background:#eaf0f8;color:#183451;padding:11px 13px;font-size:17px;border-left:5px solid #3457d5;break-after:avoid}.r-section h2 span{font-size:12px;color:#3457d5}.r-section h3{font-size:14px;margin:17px 0 8px;break-after:avoid}.r-description{font-size:12px;line-height:1.5;color:#506176!important;margin:8px 0 13px}.r-swatches{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:8px 0 13px}.r-swatch{border:1px solid #d8e1ec;border-radius:7px;overflow:hidden;break-inside:avoid}.r-color{height:55px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-swatch-label{padding:6px;font-size:10px;line-height:1.5;color:#25364c}.r-swatch-label b{font-size:11px}.r-note{font-size:11px!important;background:#edf3fb;color:#45556d!important;padding:10px;border-radius:6px;line-height:1.5}.r-table-wrap{overflow:visible}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#172d49;color:#fff;text-align:left}th,td{padding:8px 5px;border-bottom:1px solid #dce5ef}tr{break-inside:avoid}td{white-space:nowrap}.r-dot{display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:middle;border:1px solid #ccc;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-selected>div{padding:18px;border-radius:7px;font-weight:bold;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-selected p{font-size:11px;line-height:1.6}.r-previews{display:grid;grid-template-columns:1fr 1fr;gap:12px}.r-preview{border:1px solid #d6e0eb;padding:14px;border-radius:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-preview small{font-weight:bold;letter-spacing:1px}.r-preview-inner{margin-top:12px;padding:16px;border-radius:7px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-preview-inner p{font-size:11px;color:inherit!important}.r-preview-button{display:inline-block;font-size:10px;font-weight:bold;border-radius:4px;padding:9px;margin:5px 5px 0 0;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-accent{height:8px;border-radius:4px;margin-top:12px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-gradient{margin:12px 0;break-inside:avoid}.r-gradient>div{height:64px;border-radius:6px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-gradient strong{display:block;margin:6px 0;font-size:12px}.r-gradient code{font-size:10px;overflow-wrap:anywhere;line-height:1.6}.r-section pre{background:#172d49;color:#e8f3ff;padding:18px;border-radius:8px;font-size:10px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-guidance{font-size:12px;line-height:1.6}.r-footer{border-top:1px solid #dce5ef;margin-top:25px;padding-top:10px;color:#62738a;font-size:10px}@media print{html,body{background:#fff!important}.print-report{display:block!important;max-width:none;padding:0!important;margin:0!important}.r-cover{break-inside:avoid}.r-section h2{print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-swatches{grid-template-columns:repeat(6,minmax(0,1fr))}}@media(max-width:620px) and (not print){.r-swatches{grid-template-columns:repeat(3,1fr)}.r-meta{display:block}.r-previews{grid-template-columns:1fr}.r-table-wrap{overflow-x:auto}}.r-text-samples{margin:14px 0;break-inside:avoid}.r-text-samples h3{margin:12px 0 7px}.r-text-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.r-text-chip{min-width:0;border:1px solid #cfd9e5;border-radius:7px;padding:11px 7px;text-align:center;print-color-adjust:exact;-webkit-print-color-adjust:exact}.r-text-chip strong{display:block;font-size:20px;line-height:1.25}.r-text-chip small{display:block;font-size:10px;margin-top:5px;color:inherit}.r-text-chip em{display:block;font-size:9px;margin-top:4px;font-style:normal;color:inherit}.r-text-samples .r-note{margin-top:8px}@media(max-width:620px) and (not print){.r-text-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}";

  // Relatório independente da interface: os mesmos dados alimentam
  // impressão, HTML, JSON, TXT e JPEG, sem alterar o estado do projeto.
  function reportData(){
    const black="#000000",white="#FFFFFF";
    const wcag=r=>({aaNormal:r>=4.5,aaGrande:r>=3,aaaNormal:r>=7,aaaGrande:r>=4.5});
    return {
      app:"Itten",version:4,kind:"estudo-cromatico-completo",
      name:projectName(),generatedAt:new Date().toISOString(),
      bases:[...state.bases],harmony:state.harmony,
      harmonyLabel:$("harmony").selectedOptions[0]?.textContent?.trim()||state.harmony,
      count:palette.length,palette:[...palette],
      simulations:Object.fromEntries(["protanopia","deuteranopia","tritanopia"].map(type=>[type,palette.map(hex=>simulate(hex,type))])),
      accessibility:{standard:"WCAG 2.1 - contraste de texto",thresholds:{aaNormal:4.5,aaGrande:3,aaaNormal:7,aaaGrande:4.5},
        fixedBackgrounds:[white,"#10141D"],
        perColor:palette.map((hex,i)=>({index:i+1,hex,
          black:{ratio:contrast(hex,black),...wcag(contrast(hex,black))},
          white:{ratio:contrast(hex,white),...wcag(contrast(hex,white))},
          dark:{ratio:contrast(hex,"#10141D"),...wcag(contrast(hex,"#10141D"))}})),
        selectedPair:{foreground:$("foreground").value,background:$("backgroundColor").value,
          ratio:contrast($("foreground").value,$("backgroundColor").value),
          ...wcag(contrast($("foreground").value,$("backgroundColor").value))}},
      preview:{lightBackground:"#FFFFFF",darkBackground:"#10141D",primary:palette[0],secondary:palette[1]||palette[0],accent:palette[2]||palette[0]},
      gradients:{...gradients},cssTokens:cssTokens(),tailwindTokens:tailwindTokens(),
      notes:{simulations:"Aproximações RGB ilustrativas; não reproduzem a experiência visual individual nem constituem avaliação clínica.",
        contrast:"As razões WCAG referem-se a pares de cores específicos; aprovação em um par não garante acessibilidade de toda a interface.",
        preview:"Exemplos conceituais em fundos claro e escuro; verificar o contraste dos componentes reais.",
        gradients:"Transições CSS derivadas da paleta; o contraste pode variar ao longo da superfície."}
    };
  }
  function escapeReport(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function reportMarkup(d){
    const e=escapeReport;
    const swatches=(colors,label)=>`<div class="r-swatches">${colors.map((hex,i)=>`<div class="r-swatch"><div class="r-color" style="background:${hex}"></div><div class="r-swatch-label">${e(label)} ${i+1}<br><b>${hex}</b></div></div>`).join("")}</div>`;
    const section=(n,title,description,body)=>`<section class="r-section"><h2><span>${n}</span>${title}</h2><p class="r-description">${description}</p>${body}</section>`;
    const rows=d.accessibility.perColor.map(x=>`<tr><td><span class="r-dot" style="background:${x.hex}"></span> ${x.hex}</td><td>${x.black.ratio.toFixed(2)}:1</td><td>${x.white.ratio.toFixed(2)}:1</td><td>${x.dark.ratio.toFixed(2)}:1</td><td>${x.black.aaaNormal?"AAA":x.black.aaNormal?"AA":"—"}</td><td>${x.white.aaaNormal?"AAA":x.white.aaNormal?"AA":"—"}</td></tr>`).join("");
    // Amostras com as duas orientações: texto neutro sobre cor e cor sobre fundo neutro.
    const textSamples=`<div class="r-text-samples">
      <h3>Texto preto e branco sobre cada cor da paleta</h3>
      <div class="r-text-grid">${d.accessibility.perColor.map(x=>`<div class="r-text-chip" style="background:${x.hex}"><strong style="color:#000000">Aa preto</strong><strong style="color:#FFFFFF">Aa branco</strong><small style="color:${readable(x.hex)}">${x.hex}</small></div>`).join("")}</div>
      <h3>Texto nas cores da paleta sobre fundo branco</h3>
      <div class="r-text-grid">${d.accessibility.perColor.map(x=>`<div class="r-text-chip" style="background:#FFFFFF;color:${x.hex}"><strong>Aa · Texto</strong><small>${x.hex} · ${x.white.ratio.toFixed(2)}:1</small><em>${x.white.aaaNormal?"AAA":x.white.aaNormal?"AA":"Não atende AA normal"}</em></div>`).join("")}</div>
      <h3>Texto nas cores da paleta sobre fundo preto</h3>
      <div class="r-text-grid">${d.accessibility.perColor.map(x=>`<div class="r-text-chip" style="background:#000000;color:${x.hex}"><strong>Aa · Texto</strong><small>${x.hex} · ${x.black.ratio.toFixed(2)}:1</small><em>${x.black.aaaNormal?"AAA":x.black.aaNormal?"AA":"Não atende AA normal"}</em></div>`).join("")}</div>
      <p class="r-note">Os valores indicam a razão de contraste WCAG 2.1 para texto colorido sobre branco ou preto. As amostras com contraste insuficiente são mantidas para comparação, não como recomendação de uso.</p>
    </div>`;
    const previews=["light","dark"].map(mode=>{const bg=mode==="light"?d.preview.lightBackground:d.preview.darkBackground;const surface=mode==="light"?"#F3F4F6":"#202938";return `<div class="r-preview" style="background:${bg};color:${readable(bg)}"><small>${mode==="light"?"INTERFACE CLARA":"INTERFACE ESCURA"}</small><div class="r-preview-inner" style="background:${surface};color:${readable(surface)}"><b>Seu próximo projeto</b><p>Exemplo de hierarquia e aplicação das cores.</p><span class="r-preview-button" style="background:${d.preview.primary};color:${readable(d.preview.primary)}">Ação principal</span><span class="r-preview-button" style="background:${d.preview.secondary};color:${readable(d.preview.secondary)}">Secundária</span><div class="r-accent" style="background:${d.preview.accent}"></div></div></div>`;}).join("");
    const gradientNames={linear:"Linear",radial:"Radial",mesh:"Composto (mesh)"};
    return `<div class="r-cover"><div class="r-kicker">ITTEN · LABORATÓRIO CROMÁTICO</div><h1>Estudo cromático completo</h1><p>Relatório técnico e visual do projeto <strong>${e(d.name)}</strong></p><div class="r-meta"><div><small>HARMONIA</small><b>${e(d.harmonyLabel)}</b></div><div><small>QUANTIDADE</small><b>${d.count} cores</b></div><div><small>GERADO EM</small><b>${new Date(d.generatedAt).toLocaleString("pt-BR")}</b></div></div></div>
    ${section("01","Cores-base","Três cores de partida que definem a direção cromática do estudo.",swatches(d.bases,"Base"))}
    ${section("02","Paleta gerada e harmonia",`Harmonia ${e(d.harmonyLabel)} · ${d.count} cores. As cores são derivadas matematicamente das bases por transformações no espaço HSL.`,swatches(d.palette,"Cor"))}
    ${section("03","Simulações de daltonismo","Representações aproximadas da paleta sob três condições de percepção cromática; compare a distinção entre as amostras.",Object.entries(d.simulations).map(([key,colors])=>`<h3>${({protanopia:"Protanopia",deuteranopia:"Deuteranopia",tritanopia:"Tritanopia"})[key]}</h3>${swatches(colors,"Cor")}`).join("")+`<p class="r-note">${e(d.notes.simulations)}</p>`)}
    ${section("04","Laboratório de acessibilidade","Razões de contraste WCAG 2.1 para cada cor da paleta sobre preto, branco e fundo escuro do laboratório.",`<div class="r-table-wrap"><table><thead><tr><th>Cor</th><th>Sobre preto</th><th>Sobre branco</th><th>Sobre escuro</th><th>Preto: texto normal</th><th>Branco: texto normal</th></tr></thead><tbody>${rows}</tbody></table></div><p class="r-note">AA normal ≥ 4,5:1; AA grande ≥ 3:1; AAA normal ≥ 7:1; AAA grande ≥ 4,5:1. Os selos AA/AAA da tabela referem-se apenas a texto normal.</p>${textSamples}<h3>Combinação selecionada no laboratório</h3><div class="r-selected"><div style="background:${d.accessibility.selectedPair.background};color:${d.accessibility.selectedPair.foreground}">Exemplo de título e texto legível</div><p>Texto: <b>${d.accessibility.selectedPair.foreground}</b> · Fundo: <b>${d.accessibility.selectedPair.background}</b> · Razão: <b>${d.accessibility.selectedPair.ratio.toFixed(2)}:1</b><br>AA normal: ${d.accessibility.selectedPair.aaNormal?"Aprovado":"Reprovado"} · AA grande: ${d.accessibility.selectedPair.aaGrande?"Aprovado":"Reprovado"} · AAA normal: ${d.accessibility.selectedPair.aaaNormal?"Aprovado":"Reprovado"} · AAA grande: ${d.accessibility.selectedPair.aaaGrande?"Aprovado":"Reprovado"}</p></div><p class="r-note">${e(d.notes.contrast)}</p>`)}
    ${section("05","Preview Lab","Prévia ilustrativa de componentes de interface em temas claro e escuro, usando as cores principal, secundária e de destaque.",`<div class="r-previews">${previews}</div><p class="r-note">${e(d.notes.preview)}</p>`)}
    ${section("06","Gradientes","Três transições CSS geradas a partir das cores do projeto.",Object.entries(d.gradients).map(([key,css])=>`<div class="r-gradient"><div style="background:${css}"></div><strong>${gradientNames[key]||e(key)}</strong><code>${e(css)}</code></div>`).join("")+`<p class="r-note">${e(d.notes.gradients)}</p>`)}
    ${section("07","Tokens CSS","Variáveis prontas para integrar as cores-base e a paleta a outros projetos.",`<pre>${e(d.cssTokens)}</pre>`)}
    ${section("08","Orientações de uso","Leitura prática dos resultados deste estudo.",`<div class="r-guidance"><p><b>Consistência.</b> Utilize os tokens CSS para preservar a identidade cromática em todas as telas.</p><p><b>Acessibilidade.</b> Priorize pares que atendam ao menos AA e avalie também estados de foco, ícones e elementos interativos.</p><p><b>Inclusão.</b> Não dependa apenas da cor para transmitir informação; use texto, formas ou padrões.</p><p><b>Validação.</b> As simulações e previews são ferramentas auxiliares; valide a interface final nos contextos reais de uso.</p></div>`)}
    <footer class="r-footer">Itten — Laboratório Cromático · Estudo gerado localmente · ${e(d.name)}</footer>`;
  }
  function printReport(){
    const report=$("printReport");
    report.innerHTML=reportMarkup(reportData());
  }

  function validateProject(obj) {
    if(!obj || typeof obj!=="object" || Array.isArray(obj))
      throw Error("Estrutura inválida");
    if(!Array.isArray(obj.bases) || obj.bases.length!==3)
      throw Error("São necessárias três cores-base");
    const bases=obj.bases.map(normalizeHex);
    if(bases.some(c=>!c)) throw Error("Código HEX inválido");
    const allowed=[
      "integrated","complementary","analogous",
      "triadic","split","tetradic","monochromatic"
    ];
    if(!allowed.includes(obj.harmony))
      throw Error("Harmonia desconhecida");
    const count=Number(obj.count);
    if(![5,6,8,10,12].includes(count))
      throw Error("Quantidade inválida");
    return {bases,harmony:obj.harmony,count};
  }

  function load(){
    try {
      const stored=JSON.parse(localStorage.getItem(PROJECTS_KEY)||"null");
      if(Array.isArray(stored))projects=stored.filter(p=>p && typeof p.name==="string" && p.name.trim() && p.id).map(p=>({...p,data:validateProject(p.data)}));
      if(!projects.length){
        let previous=structuredDefault();
        try{const legacy=localStorage.getItem(STORAGE);if(legacy)previous=validateProject(JSON.parse(legacy));}catch{}
        projects=[{id:makeId(),name:"Projeto inicial",updated:new Date().toISOString(),data:previous}];
      }
      activeId=localStorage.getItem(ACTIVE_KEY);
      if(!projects.some(p=>p.id===activeId))activeId=projects[0].id;
      state=validateProject(projects.find(p=>p.id===activeId).data);
    }catch{
      projects=[{id:makeId(),name:"Projeto inicial",updated:new Date().toISOString(),data:structuredDefault()}];activeId=projects[0].id;state=structuredDefault();
    }
    try{if(localStorage.getItem(THEME)==="dark")document.body.classList.add("dark");}catch{}
    updateThemeButton();$("projectNameDisplay").textContent=projectName();
  }

  function updateThemeButton() {
    const dark=document.body.classList.contains("dark");
    $("themeBtn").textContent=dark?"☀":"☾";
    $("themeBtn").setAttribute("aria-label",
      dark?"Ativar modo claro":"Ativar modo escuro");
    document.querySelector('meta[name="theme-color"]')
      .setAttribute("content",dark?"#10141d":"#f5f6f8");
  }

  function renderBases() {
    $("baseInputs").innerHTML=state.bases.map((hex,i)=>`
      <div class="base-card">
        <strong>Cor-base ${i+1}</strong>
        <div class="base-edit">
          <input type="color" value="${hex}"
            data-base="${i}" aria-label="Seletor da cor ${i+1}">
          <input type="text" value="${hex}" maxlength="7"
            data-hex="${i}" aria-label="HEX da cor ${i+1}"
            spellcheck="false">
        </div>
      </div>
    `).join("");
  }

  function renderPalette() {
    $("paletteCount").textContent=`${palette.length} cores`;
    $("palette").innerHTML=palette.map((hex,i)=>`
      <button type="button" class="color-card"
        data-color="${hex}" style="background:${hex};color:${readable(hex)}"
        aria-label="Copiar ${hex}">
        <span class="color-index">COR ${String(i+1).padStart(2,"0")}</span>
        <span class="hex">${hex}</span>
        <span class="copy-icon">⧉ Copiar</span>
      </button>
    `).join("");
  }

  // Matrizes aproximativas aplicadas diretamente aos canais RGB.
  // Não representam um modelo clínico de visão de cores.
  function simulate(hex,type) {

    if(type==="normal") return hex;
    const m=MATRICES[type];
    if(!m) return hex;
    const rgb=hexToRgb(hex);
    return rgbToHex(m.map(row=>
      row.reduce((sum,v,i)=>sum+v*rgb[i],0)
    ));
  }

  function renderVision() {
    const type=$("vision").value;
    $("visionPalette").innerHTML=palette.map(hex=>{
      const value=simulate(hex,type);
      return `<div class="swatch" style="background:${value}"
        title="${hex} → ${value}" aria-label="${hex} simulado como ${value}"></div>`;
    }).join("");
  }

  function contrastBadges(ratio) {
    return [
      ["AA normal",ratio>=4.5],
      ["AA grande",ratio>=3],
      ["AAA normal",ratio>=7],
      ["AAA grande",ratio>=4.5]
    ].map(([label,pass])=>
      `<span class="metric ${pass?"pass":"fail"}">
        ${pass?"✓":"✕"} ${label}
      </span>`
    ).join("");
  }

  function renderContrast() {
    const oldFg=$("foreground").value;
    const oldBg=$("backgroundColor").value;
    const options=palette.map((hex,i)=>
      `<option value="${hex}">Cor ${i+1} · ${hex}</option>`
    ).join("")+
      `<option value="#000000">Preto · #000000</option>
       <option value="#FFFFFF">Branco · #FFFFFF</option>`;

    $("foreground").innerHTML=options;
    $("backgroundColor").innerHTML=options;
    $("foreground").value=palette.includes(oldFg)||["#000000","#FFFFFF"].includes(oldFg)
      ?oldFg:"#000000";
    $("backgroundColor").value=palette.includes(oldBg)||["#000000","#FFFFFF"].includes(oldBg)
      ?oldBg:palette[0];
    updateContrastResult();

    // Teste independente em dois fundos fixos, sem trocar o tema.
    const themes=[
      ["Tema claro","#FFFFFF"],
      ["Tema escuro","#10141D"]
    ];
    $("dualContrast").innerHTML=themes.map(([name,bg])=>{
      const rows=palette.map((hex,i)=>{
        const ratio=contrast(hex,bg);
        return `<div class="dual-row">
          <span>Cor ${i+1} · ${hex}</span>
          <span class="${ratio>=4.5?"pass":"fail"}">
            ${ratio.toFixed(2)}:1 · ${ratio>=4.5?"AA":"Falha AA"}
          </span>
        </div>`;
      }).join("");
      return `<div class="dual-card">
        <strong>${name} — ${bg}</strong>${rows}
      </div>`;
    }).join("");
  }

  function updateContrastResult() {
    const fg=$("foreground").value;
    const bg=$("backgroundColor").value;
    if(!validHex(fg)||!validHex(bg)) return;
    const ratio=contrast(fg,bg);
    $("contrastResult").innerHTML=`
      <div class="contrast-sample" style="background:${bg};color:${fg}">
        <strong style="font-size:1.25rem">Exemplo de título</strong>
        <p style="color:inherit">Texto de demonstração para verificar legibilidade.</p>
      </div>
      <div class="contrast-metrics">
        <strong>Contraste ${ratio.toFixed(2)}:1</strong>
        ${contrastBadges(ratio)}
      </div>
    `;
  }

  function renderPreview() {
    const [primary,secondary,accent]=[
      palette[0],palette[1]||palette[0],palette[2]||palette[0]
    ];
    const render=(id,bg,label)=>{
      const surface=bg==="#FFFFFF"?"#F3F4F6":"#202938";
      const heading=readable(bg);
      const text=bestText(surface,["#000000","#FFFFFF"]);
      const primaryText=readable(primary);
      const secondaryText=readable(secondary);
      $(id).style.background=bg;
      $(id).style.color=heading;
      $(id).innerHTML=`
        <div class="preview-title">${label}</div>
        <div class="preview-box" style="background:${surface};color:${text}">
          <strong>Seu próximo projeto</strong>
          <p style="color:inherit">Uma prévia de interface com as cores selecionadas.</p>
          <div class="preview-actions">
            <button style="background:${primary};color:${primaryText}">Ação principal</button>
            <button style="background:${secondary};color:${secondaryText}">Secundária</button>
          </div>
          <div style="height:8px;background:${accent};border-radius:8px;margin-top:16px"></div>
        </div>`;
    };
    render("previewLight","#FFFFFF","Light UI");
    render("previewDark","#10141D","Dark UI");
  }

  function buildGradients() {
    const a=palette[0],b=palette[1]||a,c=palette[2]||b;
    gradients={
      linear:`linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`,
      radial:`radial-gradient(circle at center, ${a} 0%, ${b} 55%, ${c} 100%)`,
      mesh:`radial-gradient(at 20% 20%, ${a} 0%, transparent 55%), radial-gradient(at 80% 25%, ${b} 0%, transparent 55%), radial-gradient(at 50% 85%, ${c} 0%, transparent 65%), ${a}`
    };
    for(const type of Object.keys(gradients))
      $(`${type}Preview`).style.background=gradients[type];
  }

  function cssTokens() {
    return `/* Itten — Projeto: ${projectName().replace(/\*\//g," ")} */\n/* Cores-base: ${state.bases.join(", ")} */\n:root {\n${state.bases.map((c,i)=>`  --itten-base-${i+1}: ${c};`).join("\n")}\n${palette.map((c,i)=>
      `  --itten-color-${i+1}: ${c};`
    ).join("\n")}\n  --itten-primary: ${palette[0]};\n  --itten-secondary: ${palette[1]||palette[0]};\n  --itten-accent: ${palette[2]||palette[0]};\n}`;
  }

  function tailwindTokens() {
    const colors=Object.fromEntries(palette.map((c,i)=>
      [`color${i+1}`,c]
    ));
    state.bases.forEach((c,i)=>colors[`base${i+1}`]=c);
    colors.primary=palette[0];
    colors.secondary=palette[1]||palette[0];
    colors.accent=palette[2]||palette[0];
    return `// Projeto: ${projectName().replace(/[\r\n]/g," ")}\n// Cores-base: ${state.bases.join(", ")}\n// tailwind.config.js — compatível com Tailwind CSS v3\nmodule.exports = ${JSON.stringify({
      theme:{extend:{colors:{itten:colors}}}
    },null,2)};`;
  }

  function renderTokens() {
    $("tokensPreview").textContent=cssTokens();
  }

  function refresh() {
    palette=generatePalette();
    renderPalette();
    renderVision();
    renderContrast();
    renderPreview();
    buildGradients();
    renderTokens();
    save();
  }

  function syncControls() {
    $("harmony").value=state.harmony;
    $("count").value=String(state.count);
    renderBases();
    refresh();
  }

  function setBase(index,value) {
    const hex=normalizeHex(value);
    if(!hex) return false;
    state.bases[index]=hex;
    const color=document.querySelector(`[data-base="${index}"]`);
    const text=document.querySelector(`[data-hex="${index}"]`);
    if(color) color.value=hex;
    if(text) text.value=hex;
    refresh();
    return true;
  }

  function downloadBlob(blob,name) {
    const url=URL.createObjectURL(blob);

    const a=document.createElement("a");
    a.href=url;
    a.download=name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }

  function exportJSON(){
    // Mantém os campos antigos na raiz para compatibilidade com importJSON.
    const d=reportData();
    downloadBlob(new Blob([JSON.stringify({...d,harmony:state.harmony,count:state.count},null,2)],{type:"application/json"}),fileName("json"));
  }
  function reportText(d){
    const lines=["ITTEN — ESTUDO CROMÁTICO COMPLETO",`Projeto: ${d.name}`,`Data: ${new Date(d.generatedAt).toLocaleString("pt-BR")}`,`Harmonia: ${d.harmonyLabel}`,`Quantidade: ${d.count}`,
      "\n01 — CORES-BASE",...d.bases.map((c,i)=>`Base ${i+1}: ${c}`),"\n02 — PALETA",...d.palette.map((c,i)=>`Cor ${i+1}: ${c}`),
      "\n03 — SIMULAÇÕES DE DALTONISMO",d.notes.simulations];
    for(const [type,colors] of Object.entries(d.simulations))lines.push(type.toUpperCase(),...colors.map((c,i)=>`Cor ${i+1}: ${c}`));
    lines.push("\n04 — ACESSIBILIDADE WCAG 2.1","AA normal ≥ 4.5:1; AA grande ≥ 3:1; AAA normal ≥ 7:1; AAA grande ≥ 4.5:1");
    for(const x of d.accessibility.perColor)lines.push(`${x.hex} | preto ${x.black.ratio.toFixed(2)}:1 (AA ${x.black.aaNormal}, AAA ${x.black.aaaNormal}) | branco ${x.white.ratio.toFixed(2)}:1 (AA ${x.white.aaNormal}, AAA ${x.white.aaaNormal}) | escuro ${x.dark.ratio.toFixed(2)}:1 (AA ${x.dark.aaNormal}, AAA ${x.dark.aaaNormal})`);
    lines.push("Amostras de texto: texto branco e preto sobre cada cor; texto em cada cor sobre fundo branco; texto em cada cor sobre fundo preto.","O contraste é simétrico: os valores de texto colorido sobre branco/preto correspondem às colunas branco/preto da tabela.");
    const p=d.accessibility.selectedPair;lines.push(`Par selecionado: ${p.foreground} sobre ${p.background}: ${p.ratio.toFixed(2)}:1; AA normal ${p.aaNormal}; AA grande ${p.aaGrande}; AAA normal ${p.aaaNormal}; AAA grande ${p.aaaGrande}`,d.notes.contrast);
    lines.push("\n05 — PREVIEW LAB",`Claro: ${d.preview.lightBackground}; escuro: ${d.preview.darkBackground}; primária: ${d.preview.primary}; secundária: ${d.preview.secondary}; destaque: ${d.preview.accent}`,d.notes.preview,"\n06 — GRADIENTES",...Object.entries(d.gradients).map(([k,v])=>`${k}: ${v}`),d.notes.gradients,"\n07 — TOKENS CSS",d.cssTokens,"\n08 — ORIENTAÇÕES","Consistência: reutilize tokens. Acessibilidade: teste pares reais. Inclusão: não use apenas cor. Validação: confira o produto final.");
    return lines.join("\n");
  }
  function exportTXT(){downloadBlob(new Blob([reportText(reportData())],{type:"text/plain;charset=utf-8"}),fileName("txt"));}
  function exportCSS(){downloadBlob(new Blob([cssTokens()],{type:"text/css;charset=utf-8"}),fileName("css"));}
  function exportTailwind(){downloadBlob(new Blob([tailwindTokens()],{type:"text/javascript;charset=utf-8"}),fileName("tailwind.config.js"));}
  function exportHTML(){
    const d=reportData();
    const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeReport(d.name)} — Itten</title><style>${REPORT_CSS}</style></head><body><main class="print-report">${reportMarkup(d)}</main></body></html>`;
    downloadBlob(new Blob([html],{type:"text/html;charset=utf-8"}),fileName("html"));
  }
  function exportJPEG(){
    // Relatório JPEG completo em uma imagem longa, sem bibliotecas externas.
    const d=reportData(),W=1400,P=64,inner=W-P*2;
    const c=document.createElement("canvas");c.width=W;
    const ctx=c.getContext("2d");if(!ctx){toast("Canvas indisponível");return;}
    // Medição de layout primeiro, para evitar cortes em relatórios extensos.
    const commands=[];let y=55;
    const line=(s,size=23,bold=false,color="#243248",indent=0)=>{commands.push({kind:"text",s:String(s),y,size,bold,color,indent});y+=size*1.65;};
    const section=(n,t,desc)=>{y+=24;commands.push({kind:"bar",y});y+=48;line(`${n}  ${t}`,29,true);line(desc,19,false,"#526176");y+=8;};
    const colors=(values,label)=>{values.forEach((hex,i)=>{const col=i%6,row=Math.floor(i/6),x=P+col*214;commands.push({kind:"swatch",x,y:y+row*156,hex,label:`${label} ${i+1}`,value:hex});});y+=Math.ceil(values.length/6)*156+10;};
    const wrap=(text,size=20,indent=0)=>{const max=92;for(const paragraph of String(text).split("\n")){if(!paragraph){y+=size;continue;}let current="";for(const word of paragraph.split(/\s+/)){if((current+" "+word).length>max){line(current,size,false,"#344156",indent);current=word;}else current+=(current?" ":"")+word;}if(current)line(current,size,false,"#344156",indent);}};
    line("ITTEN  /  LABORATÓRIO CROMÁTICO",25,true,"#3A64B4");line("Estudo cromático completo",43,true);wrap(`Projeto: ${d.name} | Harmonia: ${d.harmonyLabel} | ${d.count} cores | ${new Date(d.generatedAt).toLocaleString("pt-BR")}`);
    section("01","Cores-base","Três cores que orientam o estudo.");colors(d.bases,"Base");
    section("02","Paleta e harmonia",`Harmonia ${d.harmonyLabel} | ${d.count} cores.`);colors(d.palette,"Cor");
    section("03","Simulações de daltonismo","Representações RGB aproximadas, não clínicas.");for(const [key,values] of Object.entries(d.simulations)){line(key.toUpperCase(),23,true);colors(values,"Cor");}
    section("04","Laboratório de acessibilidade","Contraste WCAG 2.1: preto, branco e fundo escuro.");
    for(const x of d.accessibility.perColor)line(`${x.hex}    Preto ${x.black.ratio.toFixed(2)}:1 [${x.black.aaaNormal?"AAA":x.black.aaNormal?"AA":"—"}]    Branco ${x.white.ratio.toFixed(2)}:1 [${x.white.aaaNormal?"AAA":x.white.aaNormal?"AA":"—"}]    Escuro ${x.dark.ratio.toFixed(2)}:1`,20);
    line("AMOSTRAS DE TEXTO — PRETO E BRANCO SOBRE AS CORES",23,true);
    for(const x of d.accessibility.perColor){commands.push({kind:"textSample",y,hex:x.hex,mode:"both",ratio:x.black.ratio});y+=65;}
    line("AMOSTRAS DE TEXTO — CORES SOBRE FUNDO BRANCO",23,true);
    for(const x of d.accessibility.perColor){commands.push({kind:"textSample",y,hex:x.hex,mode:"white",ratio:x.white.ratio});y+=65;}
    line("AMOSTRAS DE TEXTO — CORES SOBRE FUNDO PRETO",23,true);
    for(const x of d.accessibility.perColor){commands.push({kind:"textSample",y,hex:x.hex,mode:"black",ratio:x.black.ratio});y+=65;}
    wrap("AA normal 4,5:1 | AA grande 3:1 | AAA normal 7:1 | AAA grande 4,5:1");
    const pair=d.accessibility.selectedPair;wrap(`Par selecionado: ${pair.foreground} / ${pair.background} = ${pair.ratio.toFixed(2)}:1; AA normal ${pair.aaNormal?"sim":"não"}; AA grande ${pair.aaGrande?"sim":"não"}; AAA normal ${pair.aaaNormal?"sim":"não"}; AAA grande ${pair.aaaGrande?"sim":"não"}.`);
    section("05","Preview Lab","Esquemas de aplicação em tema claro e escuro.");commands.push({kind:"previews",y,preview:d.preview});y+=210;
    section("06","Gradientes","Linear, radial e composto (mesh).");for(const [name,css] of Object.entries(d.gradients)){commands.push({kind:"gradient",y,name,css});y+=150;wrap(`${name}: ${css}`,17);}
    section("07","Tokens CSS","Variáveis para integração em outros projetos.");for(const ln of d.cssTokens.split("\n"))line(ln,19,false,"#25384C",18);
    section("08","Orientações","Aplicação, acessibilidade, inclusão e validação.");wrap("Use tokens para consistência. Priorize pares com contraste AA ou AAA. Não dependa exclusivamente da cor para comunicar informações. Valide a interface final e interprete as simulações como aproximações.");
    const H=Math.ceil(y+80);if(H>32000){toast("Relatório JPEG excede o limite do navegador; use HTML ou impressão em PDF");return;}c.height=H;
    ctx.fillStyle="#FFFFFF";ctx.fillRect(0,0,W,H);
    for(const cmd of commands){
      if(cmd.kind==="bar"){ctx.fillStyle="#172C49";ctx.fillRect(P,cmd.y,inner,7);}
      if(cmd.kind==="text"){ctx.fillStyle=cmd.color;ctx.font=`${cmd.bold?"700":"400"} ${cmd.size}px system-ui`;ctx.fillText(cmd.s,P+cmd.indent,cmd.y,inner-cmd.indent);}
      if(cmd.kind==="swatch"){ctx.fillStyle=cmd.hex;ctx.fillRect(cmd.x,cmd.y,194,102);ctx.fillStyle="#243248";ctx.font="17px system-ui";ctx.fillText(cmd.label,cmd.x,cmd.y+123);ctx.font="bold 19px system-ui";ctx.fillText(cmd.value,cmd.x,cmd.y+147);}
      if(cmd.kind==="textSample"){
        const bg=cmd.mode==="both"?cmd.hex:cmd.mode==="white"?"#FFFFFF":"#000000";
        ctx.fillStyle=bg;ctx.fillRect(P,cmd.y-34,inner,54);
        ctx.font="bold 23px system-ui";
        if(cmd.mode==="both"){
          ctx.fillStyle="#000000";ctx.fillText("Aa preto",P+18,cmd.y);
          ctx.fillStyle="#FFFFFF";ctx.fillText("Aa branco",P+210,cmd.y);
          ctx.fillStyle=readable(bg);ctx.fillText(cmd.hex,P+inner-190,cmd.y);
        }else{
          ctx.fillStyle=cmd.hex;ctx.fillText(`Aa · Texto ${cmd.hex}  |  ${cmd.ratio.toFixed(2)}:1`,P+18,cmd.y);
        }
      }
      if(cmd.kind==="previews"){for(const [i,bg] of [cmd.preview.lightBackground,cmd.preview.darkBackground].entries()){const x=P+i*655;ctx.fillStyle=bg;ctx.fillRect(x,cmd.y,635,180);ctx.fillStyle=i?"#FFFFFF":"#18263D";ctx.font="bold 24px system-ui";ctx.fillText(i?"DARK UI":"LIGHT UI",x+20,cmd.y+42);ctx.fillStyle=cmd.preview.primary;ctx.fillRect(x+20,cmd.y+75,180,65);ctx.fillStyle=cmd.preview.secondary;ctx.fillRect(x+218,cmd.y+75,180,65);ctx.fillStyle=cmd.preview.accent;ctx.fillRect(x+416,cmd.y+75,190,65);}}
      if(cmd.kind==="gradient"){const x=P,w=inner,h=78;const stops=d.palette;const g=ctx.createLinearGradient(x,cmd.y,x+w,cmd.y);stops.forEach((hex,i)=>g.addColorStop(i/(stops.length-1),hex));ctx.fillStyle=g;ctx.fillRect(x,cmd.y,w,h);ctx.fillStyle="#243248";ctx.font="bold 21px system-ui";ctx.fillText(cmd.name.toUpperCase(),x,cmd.y+110);}
    }
    c.toBlob(blob=>blob?downloadBlob(blob,fileName("jpg")):toast("Falha ao gerar JPEG"),"image/jpeg",.94);
  }

  // Quantização de cores: amostramos pixels, agrupamos em
  // cubos RGB e calculamos médias ponderadas por frequência.
  // Isso evita usar a imagem inteira em memória.
  async function extractImage(file) {
    if(!file || !file.type.startsWith("image/")) {
      toast("Selecione uma imagem válida");
      return;
    }
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)) {
      toast("Formato não suportado");
      return;
    }
    if(file.size>MAX_IMAGE_BYTES) {
      toast("Imagem maior que 20 MB");
      return;
    }
    let bitmap;
    try {
      bitmap=await createImageBitmap(file);
      const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height));
      const w=Math.max(1,Math.round(bitmap.width*scale));
      const h=Math.max(1,Math.round(bitmap.height*scale));
      const canvas=document.createElement("canvas");
      canvas.width=w;
      canvas.height=h;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      if(!ctx) throw Error("Canvas indisponível");
      ctx.drawImage(bitmap,0,0,w,h);
      const pixels=ctx.getImageData(0,0,w,h).data;
      const bins=new Map();

      for(let i=0;i<pixels.length;i+=16) {
        const alpha=pixels[i+3];
        if(alpha<128) continue;
        const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        const key=`${r>>4},${g>>4},${b>>4}`;
        let bin=bins.get(key);
        if(!bin) {
          bin={r:0,g:0,b:0,n:0};
          bins.set(key,bin);
        }
        bin.r+=r;bin.g+=g;bin.b+=b;bin.n++;
      }

      const ranked=[...bins.values()].sort((a,b)=>b.n-a.n);
      const chosen=[];
      for(const bin of ranked) {
        const rgb=[bin.r/bin.n,bin.g/bin.n,bin.b/bin.n];
        // Distância RGB evita várias amostras quase idênticas.
        const distinct=chosen.every(other=>
          Math.hypot(...rgb.map((v,i)=>v-other[i]))>45
        );
        if(distinct) chosen.push(rgb);
        if(chosen.length>=6) break;
      }
      extracted=chosen.map(rgbToHex);
      if(!extracted.length) throw Error("Nenhuma cor encontrada");
      $("extracted").innerHTML=extracted.map(c=>
        `<button type="button" class="swatch" data-extracted="${c}"
          style="background:${c}" title="Copiar ${c}"
          aria-label="Copiar ${c}"></button>`
      ).join("");
      $("applyExtracted").disabled=false;
      toast(`${extracted.length} cores extraídas`);
    } catch {
      toast("Não foi possível processar a imagem");
    } finally {
      if(bitmap) bitmap.close();
    }
  }

  function randomHex() {
    const bytes=new Uint8Array(3);
    if(crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for(let i=0;i<3;i++) bytes[i]=Math.floor(Math.random()*256);
    return rgbToHex([...bytes]);
  }

  function closeMenu(){
    $("sideMenu").classList.remove("open");
    $("sideMenu").setAttribute("aria-hidden","true");
    $("sideMenu").inert=true;
    $("menuBackdrop").hidden=true;
    $("menuBtn").setAttribute("aria-expanded","false");
    $("exportOptions").hidden=true;
    $("exportBtn").setAttribute("aria-expanded","false");
  }

  function toggleMenu(){
    if($("sideMenu").classList.contains("open")){
      closeMenu();
      return;
    }
    $("sideMenu").inert=false;
    $("sideMenu").setAttribute("aria-hidden","false");
    $("sideMenu").classList.add("open");
    $("menuBackdrop").hidden=false;
    $("menuBtn").setAttribute("aria-expanded","true");
  }

  function setupEvents() {
    $("menuBtn").addEventListener("click",toggleMenu);
    $("closeMenuBtn").addEventListener("click",closeMenu);
    $("menuBackdrop").addEventListener("click",closeMenu);
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape")closeMenu();
    });
    $("projectsBtn").addEventListener("click",()=>{
      renderProjects();
      $("projectsDialog").showModal();
    });
    $("closeProjectsBtn").addEventListener("click",()=>
      $("projectsDialog").close()
    );
    $("cancelNameBtn").addEventListener("click",()=>
      $("nameDialog").close()
    );
    $("nameForm").addEventListener("submit",e=>{
      e.preventDefault();
      const name=$("projectNameInput").value.trim();
      if(!name){
        $("nameError").textContent="Informe um nome.";
        return;
      }
      if(!uniqueName(name,editingId)){
        $("nameError").textContent="Já existe um projeto com esse nome.";
        return;
      }
      if(editingId){
        const p=projects.find(p=>p.id===editingId);
        if(p){
          p.name=name;
          save();
          renderProjects();
          toast("Projeto renomeado");
        }
      }else{
        addProject(name,structuredDefault());
        extracted=[];
        $("extracted").replaceChildren();
        $("applyExtracted").disabled=true;
        $("vision").value="normal";
        toast("Projeto criado");
      }
      $("nameDialog").close();

    });
    $("projectsList").addEventListener("click",e=>{
      const btn=e.target.closest("[data-action]");if(!btn)return;
      const p=projects.find(p=>p.id===btn.dataset.id);if(!p)return;
      switch(btn.dataset.action){
        case "open":openProject(p.id);break;
        case "rename":openNameDialog(p.id);break;
        case "duplicate":{let name=p.name+" (cópia)",n=2;while(!uniqueName(name))name=`${p.name} (cópia ${n++})`;addProject(name,p.data);renderProjects();toast("Projeto duplicado");break;}
        case "delete":{
          if(projects.length===1){toast("Mantenha pelo menos um projeto");return;}
          if(!confirm(`Excluir definitivamente o projeto “${p.name}” deste navegador?`))return;
          projects=projects.filter(x=>x.id!==p.id);
          if(activeId===p.id){activeId=projects[0].id;state=validateProject(projects[0].data);syncControls();}
          save();renderProjects();toast("Projeto excluído");break;
        }
      }
    });
    $("baseInputs").addEventListener("input",e=>{
      if(e.target.matches("[data-base]"))
        setBase(Number(e.target.dataset.base),e.target.value);
    });

    $("baseInputs").addEventListener("change",e=>{
      if(e.target.matches("[data-hex]")) {
        const i=Number(e.target.dataset.hex);
        if(!setBase(i,e.target.value)) {
          e.target.value=state.bases[i];
          toast("Digite um HEX válido, como #3457D5");
        }
      }
    });

    $("harmony").addEventListener("change",e=>{
      state.harmony=e.target.value;
      refresh();
    });
    $("count").addEventListener("change",e=>{
      state.count=Number(e.target.value);
      refresh();
    });
    $("regenerateBtn").addEventListener("click",refresh);

    $("randomBtn").addEventListener("click",()=>{
      state.bases=Array.from({length:3},randomHex);
      syncControls();
    });

    $("newBtn").addEventListener("click",()=>{closeMenu();openNameDialog();});

    $("themeBtn").addEventListener("click",()=>{
      document.body.classList.toggle("dark");
      updateThemeButton();
      try {
        localStorage.setItem(THEME,
          document.body.classList.contains("dark")?"dark":"light");
      } catch {}
    });

    $("printBtn").addEventListener("click",()=>{closeMenu();printReport();window.print();});
    $("importBtn").addEventListener("click",()=>{closeMenu();$("jsonInput").click();});
    $("jsonInput").addEventListener("change",async e=>{
      await importJSON(e.target.files[0]);
      e.target.value="";
    });

    $("exportBtn").addEventListener("click",()=>{
      const el=$("exportOptions");
      el.hidden=!el.hidden;
      $("exportBtn").setAttribute("aria-expanded",String(!el.hidden));
    });

    $("exportOptions").addEventListener("click",e=>{
      const type=e.target.closest("[data-export]")?.dataset.export;
      if(!type) return;
      $("exportOptions").hidden=true;
      $("exportBtn").setAttribute("aria-expanded","false");
      const actions={
        json:exportJSON,txt:exportTXT,jpeg:exportJPEG,html:exportHTML,
        css:exportCSS,tailwind:exportTailwind
      };
      actions[type]?.();
      closeMenu();
    });

    $("palette").addEventListener("click",e=>{
      const hex=e.target.closest("[data-color]")?.dataset.color;
      if(hex) copy(hex);
    });
    $("extracted").addEventListener("click",e=>{
      const hex=e.target.closest("[data-extracted]")?.dataset.extracted;
      if(hex) copy(hex);
    });
    $("vision").addEventListener("change",renderVision);
    $("foreground").addEventListener("change",updateContrastResult);
    $("backgroundColor").addEventListener("change",updateContrastResult);
    $("copyTokens").addEventListener("click",()=>copy(cssTokens()));

    document.querySelectorAll("[data-copy-gradient]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const type=btn.dataset.copyGradient;
        copy(`background: ${gradients[type]};`);
      });
    });

    const drop=$("dropzone");
    drop.addEventListener("click",()=>$("imageInput").click());
    drop.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" ") {
        e.preventDefault();
        $("imageInput").click();
      }
    });
    $("imageInput").addEventListener("change",async e=>{
      await extractImage(e.target.files[0]);
      e.target.value="";
    });
    drop.addEventListener("dragover",e=>{
      e.preventDefault();
      drop.classList.add("dragging");
    });
    drop.addEventListener("dragleave",()=>{
      drop.classList.remove("dragging");
    });
    drop.addEventListener("drop",e=>{
      e.preventDefault();
      drop.classList.remove("dragging");
      extractImage(e.dataTransfer.files[0]);
    });
    $("applyExtracted").addEventListener("click",()=>{
      if(!extracted.length) return;
      state.bases=Array.from({length:3},(_,i)=>
        extracted[i]||extracted[0]);
      syncControls();
      toast("Cores aplicadas à paleta");
    });
  }

  // A animação visual dura 3 segundos e nunca bloqueia a inicialização.
  // A classe é definida no HEAD, antes da primeira renderização.
  function finishSplash() {
    const splash=document.getElementById("ittenSplash");
    if(!document.documentElement.classList.contains("itten-splash-active")) {
      splash?.remove();
      return;
    }
    window.setTimeout(()=>{
      document.documentElement.classList.remove("itten-splash-active");
      splash?.remove();
    },3000);
  }

  async function init() {
    finishSplash();
    load();
    syncControls();
    setupEvents();
    printReport();
    if("serviceWorker" in navigator &&
       location.protocol!=="file:") {
      try {
        await navigator.serviceWorker.register("./sw.js",{
          scope:"./"
        });
      } catch(err) {
        console.warn("Service Worker indisponível:",err);
      }
    }
    if(!storageAvailable)
      toast("Armazenamento local indisponível nesta sessão");
  }

  init();
})();

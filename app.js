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
  function printReport(){
    $("printProjectName").textContent=`Projeto: ${projectName()}`;
    $("printMetadata").textContent=`Harmonia: ${$("harmony").selectedOptions[0].textContent} · Quantidade: ${palette.length} cores`;
    function fill(id,colors,prefix){const target=$(id);target.replaceChildren();colors.forEach((hex,i)=>{
      const card=document.createElement("div");card.className="print-swatch";
      const color=document.createElement("div");color.className="print-swatch-color";color.style.backgroundColor=hex;
      const label=document.createElement("div");label.className="print-swatch-label";label.textContent=`${prefix} ${i+1} · ${hex}`;
      card.append(color,label);target.append(card);
    });}
    fill("printBases",state.bases,"Base");fill("printPalette",palette,"Cor");
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

  function exportJSON() {
    const obj={
      app:"Itten",
      version:2,
      name:projectName(),
      ...state,
      palette:[...palette]
    };
    downloadBlob(new Blob([JSON.stringify(obj,null,2)],{
      type:"application/json"
    }),fileName("json"));
  }

  function exportTXT() {
    const text=[
      "ITTEN — PALETA CROMÁTICA",
      `Projeto: ${projectName()}`,
      `Harmonia: ${state.harmony}`,
      "Cores-base:",
      ...state.bases.map((c,i)=>`Base ${i+1}: ${c}`),
      "Paleta gerada:",
      "",
      ...palette.map((c,i)=>`Cor ${i+1}: ${c}`)
    ].join("\n");
    downloadBlob(new Blob([text],{type:"text/plain;charset=utf-8"}),
      fileName("txt"));
  }

  function exportCSS() {
    downloadBlob(new Blob([cssTokens()],{type:"text/css;charset=utf-8"}),
      fileName("css"));
  }

  function exportTailwind() {
    downloadBlob(new Blob([tailwindTokens()],{
      type:"text/javascript;charset=utf-8"
    }),fileName("tailwind.config.js"));
  }

  function exportJPEG(){
    const width=1400,margin=64,gap=16,cols=3,cellW=(width-margin*2-gap*(cols-1))/cols,cellH=190;
    const baseY=270,paletteY=baseY+cellH+110,rows=Math.ceil(palette.length/cols);
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=paletteY+rows*(cellH+gap)+margin;
    const ctx=canvas.getContext("2d");if(!ctx){toast("Canvas indisponível");return;}
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle="#17202D";ctx.font="bold 55px system-ui";ctx.fillText("Itten",margin,78);
    ctx.font="bold 30px system-ui";ctx.fillText(`Projeto: ${projectName()}`.slice(0,64),margin,132);
    ctx.font="24px system-ui";ctx.fillText(`Harmonia: ${state.harmony} · ${palette.length} cores`,margin,175);
    const title=(text,y)=>{ctx.fillStyle="#17202D";ctx.font="bold 28px system-ui";ctx.fillText(text,margin,y);};
    const swatch=(hex,i,y,prefix)=>{const x=margin+(i%cols)*(cellW+gap),yy=y+Math.floor(i/cols)*(cellH+gap);
      ctx.fillStyle=hex;ctx.fillRect(x,yy,cellW,cellH);ctx.fillStyle=readable(hex);ctx.font="bold 28px system-ui";ctx.fillText(`${prefix} ${i+1} · ${hex}`,x+18,yy+cellH-22);};
    title("Cores-base",baseY-25);state.bases.forEach((c,i)=>swatch(c,i,baseY,"Base"));
    title("Paleta gerada",paletteY-25);palette.forEach((c,i)=>swatch(c,i,paletteY,"Cor"));
    canvas.toBlob(blob=>{if(blob)downloadBlob(blob,fileName("jpg"));else toast("Falha ao gerar JPEG");},"image/jpeg",.94);
  }

  async function importJSON(file){
    if(!file)return;if(file.size>1024*1024){toast("JSON muito grande");return;}
    try{
      const obj=JSON.parse(await file.text());const data=validateProject(obj);
      let name=typeof obj.name==="string"?obj.name.trim().slice(0,80):"Projeto importado";
      if(!name)name="Projeto importado";
      const original=name;let n=2;while(!uniqueName(name))name=`${original} (${n++})`;
      addProject(name,data);extracted=[];$("extracted").replaceChildren();$("applyExtracted").disabled=true;
      toast(`Projeto importado: ${name}`);
    }catch(err){toast("Importação recusada: "+err.message);}
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
        json:exportJSON,txt:exportTXT,jpeg:exportJPEG,
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

  // A animação visual dura 2 segundos e nunca bloqueia a inicialização.
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
    },2000);
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

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Users, LayoutGrid, Plus, Trash2, GripVertical, Trophy, ChevronRight, Shuffle, Upload, AlertTriangle, MapPin, Settings, AlertCircle, Check, Info, Printer, Edit2, MoveHorizontal, Loader2, Calendar, Coffee, X, Key, MessageSquare, RefreshCw, Star, ChevronDown, ChevronUp, Wrench, Grid, Save, FolderOpen, ShieldCheck, Download, UserCheck, Sparkles, Search, List, Wand2, Mail, Phone, Copy, History, Shield, Filter, ArrowUpDown, Map as MapIcon, Clock, Lock, Unlock, Link, Minus, HelpCircle, BookOpen, Zap, Target, FileText } from 'lucide-react';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

// --- HJÆLPE-TALEBOBLE (TOOLTIP) KOMPONENT ---
const HelpTip = ({ text, position = 'top' }) => (
  <span className="relative group/tip inline-flex items-center">
    <HelpCircle className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-help transition-colors" />
    <span className={`absolute ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} left-1/2 -translate-x-1/2 px-3 py-2 bg-gray-800 text-white text-[10px] rounded-lg shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-normal w-56 z-[60] leading-relaxed`}>
      {text}
      <span className={`absolute ${position === 'top' ? 'top-full border-t-gray-800' : 'bottom-full border-b-gray-800'} left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 ${position === 'top' ? 'border-t-4' : 'border-b-4'} border-transparent`}></span>
    </span>
  </span>
);

// --- GUIDE-TRIN TIL ONBOARDING WIZARD ---
const GUIDE_STEPS = [
  { titel: 'Importer rækker', tab: 'rækker', tekst: 'Start med at importere dine turneringsrækker. Klik "Importer rækker" i sidepanelet til venstre, og upload din RækkePuljeOversigt .xls fra foda.' },
  { titel: 'Upload ønsker', tab: 'ønsker', tekst: 'Upload klubbernes ønskefil her. Ønsker klassificeres automatisk som regler (f.eks. undgå vært, samme pulje).' },
  { titel: 'Sæt kriterier', tab: 'kriterier', tekst: 'Vælg regler der styrer fordelingen — f.eks. undgå samme klub i pulje, banekapacitet og geografisk nærhed.' },
  { titel: 'Fordel hold', tab: 'rækker', tekst: 'Klik "Fordel ALLE" i toolbaren øverst for at fordele alle hold i puljer automatisk.' },
  { titel: 'Validér', tab: 'rækker', tekst: 'Klik "Validér" for at tjekke at fordelingen overholder regler, banekapacitet og ønsker.' },
  { titel: 'Gem eller PDF', tab: 'rækker', tekst: 'Gem dit arbejde med "Gem"-knappen øverst til højre, eller eksporter stævneplanen som PDF.' },
];

// --- DEFINITION AF MASKIN-REGLER FRA ØNSKER ---
const RULE_TYPES = [
  { id: 'FORCE_HOST', label: 'Tving som Værtsklub' },
  { id: 'AVOID_HOST', label: 'Må IKKE være vært' },
  { id: 'SAME_POOL', label: 'Tving hold i SAMME pulje' },
  { id: 'SAME_LOCATION', label: 'Tving samme lokation' }, // Behandles p.t. relateret til hosts
  { id: 'AVOID_CLUB', label: 'Vil undgå modstander' },
  { id: 'OBS', label: 'OBS punkt til planlægger' },
  { id: 'UNKNOWN', label: '⚠️ Ukendt (Kræver tjek)' }
];

// Automatisk genkendelse af regler baseret på tekst
function extractRuleFromText(text) {
  const t = text.toLowerCase();

  // 1. AVOID_HOST (tjek først — "ikke afholde" skal matche før "afholde")
  if (t.includes('ikke afholde') || t.includes('kan ikke afholde') ||
      t.includes('kan ikke være vært') || t.includes('ingen hjemmestævner') ||
      t.includes('ønsker ikke at afholde') ||
      t.match(/skal ikke have flere stæv/) ||
      t.match(/ingen u\d/) || t.match(/kan kun afholde \d:\d/))
    return 'AVOID_HOST';

  // 2. FORCE_HOST
  if (t.includes('afholde') || t.includes('hjemmestævne') || t.includes('hjemmebane') ||
      t.includes('holde stævne') || t.includes('holde stævnet') ||
      t.includes('holde u') || t.includes('være vært') || t.includes('værtsklub') ||
      t.includes('lægge græs til'))
    return 'FORCE_HOST';

  // 3. SAME_POOL
  if (t.includes('samme pulje') || t.includes('møde hinanden') || t.includes('alle 4 hold sammen'))
    return 'SAME_POOL';

  // 4. SAME_LOCATION
  if (t.includes('samme sted') || t.includes('spille samme sted') ||
      t.includes('sendes forskellige steder') || t.match(/skal spille i \w/) ||
      t.match(/begge hold.*samme sted/))
    return 'SAME_LOCATION';

  // 5. AVOID_CLUB
  if (t.includes('undgå') || t.includes('ikke spille mod') || t.includes('møde andre end') ||
      t.includes('ikke møde') || t.includes('gider ikke at møde') ||
      t.includes('ikke skal spille mod hinanden') || t.includes('helst ikke møde'))
    return 'AVOID_CLUB';

  // 6. OBS
  if (t.includes('obs') || t.includes('bemærk') || t.includes('overvej') ||
      t.includes('jubilæum') || t.includes('klubdag'))
    return 'OBS';

  return 'UNKNOWN';
}

// Adskil kontaktinfo (navne, emails, tlf) fra fri tekst i kontaktperson-feltet
const EMAIL_RE = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?45[\s-]?)?\b(?:\d{2}[\s-]?){3}\d{2}\b/;
const DK_SENTENCE_WORDS = /\b(er|for|med|ikke|nogen|har|skal|kan|vil|det|den|de|en|et|være|gerne|hold|tilmeldt|niveau|højst|gode|baner|pulje|lørdag|søndag|spille|ønsker|helst|mest|alle|mange|kun|også|hvis|eller|men|dog|dem|denne|disse|hvor|hvad|hvem|hvordan|fra|til|hos|ved|efter|under|over|mod|mellem|inden|uden|af|som|der|dig|mig|sig)\b/i;

function splitContactFromText(rawContact) {
  if (!rawContact) return { contact: '', overflow: '' };

  // Split på newlines og semicolons til individuelle segmenter
  const segments = rawContact.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
  const contactParts = [];
  const textParts = [];

  for (const seg of segments) {
    const hasEmail = EMAIL_RE.test(seg);
    const hasPhone = PHONE_RE.test(seg);

    if (hasEmail || hasPhone) {
      // Indeholder email/tlf → kontaktinfo
      contactParts.push(seg);
    } else if (DK_SENTENCE_WORDS.test(seg) && seg.split(/\s+/).length > 2) {
      // Indeholder danske sætningsord og er mere end 2 ord → fri tekst
      textParts.push(seg);
    } else {
      // Kort tekst uden sætningsord → antag det er et navn
      contactParts.push(seg);
    }
  }

  return {
    contact: contactParts.join(', ').replace(/^[,\s]+|[,\s]+$/g, ''),
    overflow: textParts.join('. ').replace(/^[.\s]+|[.\s]+$/g, '')
  };
}

// NYT: Funktion til at gøre både e-mailadresser og telefonnumre klikbare
const renderContactInfo = (text) => {
  if (!text) return null;
  // Fanger emails og telefonnumre (fx +45 12 34 56 78, 12345678, 12 34 56 78)
  const masterRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+|(?:\+?45[\s-]?)?\b(?:\d{2}[\s-]?){3}\d{2}\b)/gi;
  const parts = text.split(masterRegex);
  
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.includes('@')) {
      return (
        <a key={i} href={`mailto:${part}`} className="text-blue-600 hover:text-blue-800 underline transition-colors inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Mail className="w-3 h-3" />{part}
        </a>
      );
    }
    // Tjekker om det udelukkende er tal, mellemrum, bindestreg og evt. et plus
    if (/^[\s\-\+\d]+$/.test(part) && part.replace(/[\s\-\+]/g, '').length >= 8) {
      const cleanPhone = part.replace(/[\s-]/g, ''); // Fjerner mellemrum til selve opkaldet
      return (
        <a key={i} href={`tel:${cleanPhone}`} className="text-green-600 hover:text-green-800 underline transition-colors inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Phone className="w-3 h-3" />{part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

// --- ØNSKER PARSING HJÆLPEFUNKTIONER ---
function parseCSV(text) {
  const firstLine = text.split('\n')[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const result = [];
  let row = [];
  let inQuotes = false;
  let currentValue = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentValue += '"'; 
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(currentValue);
      currentValue = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++; 
      row.push(currentValue);
      if (row.length > 1 || row[0] !== '') {
        result.push(row);
      }
      row = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  
  if (currentValue || row.length > 0) {
    row.push(currentValue);
    if (row.length > 1 || row[0] !== '') {
      result.push(row);
    }
  }
  
  return result;
}

function splitÅrgang(årgangStr) {
  if (!årgangStr || årgangStr.trim() === '') return ['Generelt'];
  let normalized = årgangStr.replace(/(U\d+)\s+(U\d+)/gi, '$1, $2');
  let parts = normalized.split(/,|\bog\b|\+|&|\//i);
  let cleanedParts = parts.map(p => p.trim()).filter(p => p.length > 0);
  return cleanedParts.length > 0 ? cleanedParts : ['Generelt'];
}

function cleanArgang(argangStr) {
  if (!argangStr || argangStr === 'Generelt' || argangStr.toLowerCase() === 'alle') return argangStr;
  const match = argangStr.match(/u?\d+/i);
  if (match) {
    let numStr = match[0].toLowerCase().replace('u', '');
    return 'U' + numStr;
  }
  return argangStr;
}

function extractKoen(klub, argang, onske) {
  const combined = `${klub} ${argang} ${onske}`.toLowerCase();
  if (combined.match(/\b(piger|pige|pi|pigerne)\b/)) return 'Piger';
  if (combined.match(/\b(drenge|dreng|drengene)\b/)) return 'Drenge';
  return 'Ikke angivet';
}

function extractNiveauer(argang, onske) {
  const combined = `${argang} ${onske}`.toLowerCase();
  const niveauer = new Set();
  
  if (combined.match(/\ba\b/) || combined.match(/u\d+a\b/) || combined.match(/\ba-række/)) niveauer.add('A');
  if (combined.match(/\bb\b/) || combined.match(/u\d+b\b/) || combined.match(/\bb-række/)) niveauer.add('B');
  if (combined.match(/\bc\b/) || combined.match(/u\d+c\b/) || combined.match(/\bc-række/)) niveauer.add('C');
  if (combined.match(/blandet/)) niveauer.add('Blandet');
  if (combined.match(/begynder/)) niveauer.add('Begynder');
  if (combined.match(/nystartet/)) niveauer.add('Nystartet');
  
  if (niveauer.size === 0) return ['Ikke angivet'];
  return Array.from(niveauer);
}

function processWishesData(csvText) {
  const rows = parseCSV(csvText);
  const processed = [];
  let currentCategory = "Generelle ønsker";

  rows.forEach((row, index) => {
    if (index === 0 && row[0] === 'Klub') return;

    const klub = row[0] ? row[0].trim() : '';
    const argang = row[1] ? row[1].trim() : '';
    const onske = row[2] ? row[2].trim() : '';
    const rawKontakt = row[3] ? row[3].trim() : '';

    if (!klub && !argang && !rawKontakt && !onske) return;

    if (klub && !argang && !onske && !rawKontakt) {
      currentCategory = klub;
      return;
    }

    // Adskil kontaktinfo fra fri tekst
    const { contact: kontakt, overflow: kontaktOverflow } = splitContactFromText(rawKontakt);
    const fullOnske = kontaktOverflow ? (onske ? `${onske}. ${kontaktOverflow}` : kontaktOverflow) : onske;

    const rowKoen = extractKoen(klub, argang, fullOnske);
    const rowNiveauer = extractNiveauer(argang, fullOnske);
    let argange = splitÅrgang(argang);

    // Tjek om årgang mangler, og prøv at udlede den fra ønsketekst
    if (argange.length === 1 && argange[0] === 'Generelt') {
      const combinedForAge = `${klub} ${fullOnske}`;
      const foundAges = combinedForAge.match(/u\d+/gi);
      if (foundAges) {
        argange = [...new Set(foundAges.map(a => cleanArgang(a)))];
      }
    }

    // Ekstraher maskin-regel
    const rule = extractRuleFromText(fullOnske);

    argange.forEach(a => {
      processed.push({
        id: `wish_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        kategori: currentCategory,
        club: normalizeClubName(klub) || 'Ukendt klub',
        age: cleanArgang(a),
        koen: rowKoen,
        niveauer: rowNiveauer,
        text: fullOnske,
        contact: kontakt,
        ruleType: rule,
        isActive: true,
        priority: 0
      });
    });
  });

  return processed;
}

// Konverter ønske-kategori dato ("26. oktober") til DD/MM format ("26/10")
const MONTH_MAP = { januar: '01', februar: '02', marts: '03', april: '04', maj: '05', juni: '06', juli: '07', august: '08', september: '09', oktober: '10', november: '11', december: '12' };
function wishCategoryToDateStr(kategori) {
  if (!kategori || kategori === 'Generelle ønsker') return null;
  const m = kategori.match(/^(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)$/i);
  if (!m) return null;
  return `${m[1]}/${MONTH_MAP[m[2].toLowerCase()]}`;
}

// --- EXCEL ØNSKER PARSING ---
const DATE_HEADER_REGEX = /^\d{1,2}\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)$/i;

function processExcelWishes(rows) {
  const processed = [];
  let currentCategory = 'Generelle ønsker';
  let lastWishRef = null; // Reference til seneste ønske for fortsættelsesrækker

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const klub = row[0] ? String(row[0]).trim() : '';
    const argang = row[1] ? String(row[1]).trim() : '';
    const onske = row[2] ? String(row[2]).trim() : '';
    const rawKontakt = row[3] ? String(row[3]).trim() : '';
    const note = row[6] ? String(row[6]).trim() : '';

    // Skip header-række
    if (i === 0 && klub.toLowerCase() === 'klub') continue;

    // Skip tomme rækker
    if (!klub && !argang && !onske && !rawKontakt) {
      continue;
    }

    // Detekter dato-sektionsheadere (kun col 0 udfyldt, matcher dato-mønster)
    if (klub && !argang && !onske && !rawKontakt) {
      if (DATE_HEADER_REGEX.test(klub)) {
        currentCategory = klub;
        lastWishRef = null;
        continue;
      }
    }

    // Adskil kontaktinfo fra fri tekst
    const { contact: kontakt, overflow: kontaktOverflow } = splitContactFromText(rawKontakt);

    // Fortsættelsesrækker: col 0 er tom, men col 2 (eller col 3) har indhold
    if (!klub && (onske || rawKontakt)) {
      if (lastWishRef) {
        if (onske) lastWishRef.text += ' ' + onske;
        if (kontaktOverflow) lastWishRef.text += ' ' + kontaktOverflow;
        if (kontakt && !lastWishRef.contact) lastWishRef.contact = kontakt;
        else if (kontakt) lastWishRef.contact += ', ' + kontakt;
        // Re-evaluer regel efter sammenføjning
        lastWishRef.ruleType = extractRuleFromText(lastWishRef.text);
      }
      continue;
    }

    // Standard datarække
    let fullOnske = note ? `${onske} (Note: ${note})` : onske;
    if (kontaktOverflow) fullOnske = fullOnske ? `${fullOnske}. ${kontaktOverflow}` : kontaktOverflow;
    const rowKoen = extractKoen(klub, argang, fullOnske);
    const rowNiveauer = extractNiveauer(argang, fullOnske);
    let argange = splitÅrgang(argang);

    // Prøv at udlede årgang fra ønsketekst hvis den mangler
    if (argange.length === 1 && argange[0] === 'Generelt') {
      const combinedForAge = `${klub} ${fullOnske}`;
      const foundAges = combinedForAge.match(/u\d+/gi);
      if (foundAges) {
        argange = [...new Set(foundAges.map(a => cleanArgang(a)))];
      }
    }

    const rule = extractRuleFromText(fullOnske);

    argange.forEach(a => {
      const wish = {
        id: `wish_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        kategori: currentCategory,
        club: normalizeClubName(klub) || 'Ukendt klub',
        age: cleanArgang(a),
        koen: rowKoen,
        niveauer: rowNiveauer,
        text: fullOnske,
        contact: kontakt,
        ruleType: rule,
        isActive: true,
        priority: 0
      };
      processed.push(wish);
      lastWishRef = wish;
    });
  }

  return processed;
}

// Hjælpefunktion til at validere om et ønske matcher en bestemt række
const isWishApplicableToRow = (wish, rowName) => {
   if (!wish.isActive) return false;
   const rLower = rowName.toLowerCase();
   
   // Tjek årgang
   if (wish.age && wish.age !== 'Generelt' && wish.age.toLowerCase() !== 'alle') {
       if (!rLower.includes(wish.age.toLowerCase())) return false;
   }
   
   // Tjek køn
   if (wish.koen !== 'Ikke angivet') {
       if (wish.koen === 'Piger' && !rLower.includes('pige')) return false;
       if (wish.koen === 'Drenge' && !rLower.includes('dreng')) return false;
   }

   // Tjek Niveau
   if (wish.niveauer && wish.niveauer[0] !== 'Ikke angivet') {
       const rowWords = rLower.split(/[\s-]/);
       const rowHasNiveau = wish.niveauer.some(n => {
           return rowWords.includes(n.toLowerCase());
       });
       // Vi er lemfældige her: Hvis niveau er angivet, og IKKE findes i rækkenavnet, så antager vi det ikke matcher (medmindre rækken ikke nævner A, B, C).
       const containsAnyNiveau = rowWords.some(w => ['a', 'b', 'c'].includes(w));
       if (containsAnyNiveau && !rowHasNiveau) return false;
   }

   return true;
};

// --- Algoritme til at finde den optimale puljefordeling ---
const getOptimalPoolConfig = (totalTeams) => {
  if (totalTeams === 0) return { poolCount: 0, hasWarning: false };
  if (totalTeams < 3) return { poolCount: 1, hasWarning: true };

  const costs = { 5: 1, 6: 2, 4: 4, 7: 10, 3: 20 };
  const dp = Array(totalTeams + 1).fill({ cost: Infinity, count: 0, hasSuboptimal: false });
  dp[0] = { cost: 0, count: 0, hasSuboptimal: false };

  for (let i = 1; i <= totalTeams; i++) {
    let best = { cost: Infinity, count: 0, hasSuboptimal: false };
    for (const [s, cost] of Object.entries(costs)) {
      const size = parseInt(s);
      if (i >= size && dp[i - size].cost !== Infinity) {
        const isSuboptimal = size === 3 || size === 7 || dp[i - size].hasSuboptimal;
        const newCost = dp[i - size].cost + cost;
        if (newCost < best.cost) {
          best = { cost: newCost, count: dp[i - size].count + 1, hasSuboptimal: isSuboptimal };
        }
      }
    }
    dp[i] = best;
  }

  if (dp[totalTeams].cost === Infinity) return { poolCount: 1, hasWarning: true };
  return { poolCount: dp[totalTeams].count, hasWarning: dp[totalTeams].hasSuboptimal };
};

const fodaMatrices = {
  "3 hold - 1 bane - dobbelt": { size: 3, matrix: [[0,2,2],[2,0,2],[2,2,0]] },
  "4 hold - 1 bane - dobbelt": { size: 4, matrix: [[0,2,2,2],[2,0,2,2],[2,2,0,2],[2,2,2,0]] },
  "4 hold - 2 baner - 3 kampe": { size: 4, matrix: [[0,1,1,1],[1,0,1,1],[1,1,0,1],[1,1,1,0]] },
  "5 hold - 1 bane - 6 kampe": { size: 5, matrix: [[0,2,1,1,2],[2,0,2,1,1],[1,2,0,2,1],[1,1,2,0,2],[2,1,1,2,0]] },
  "5 hold - 2 baner - 3 kampe": { size: 5, matrix: [[0,1,1,0,1],[1,0,1,1,0],[1,1,0,1,1],[0,1,1,0,1],[1,0,1,1,0]] },
  "6 hold - 2 baner - 3 kampe": { size: 6, matrix: [[0,1,1,1,0,0],[1,0,0,0,1,1],[1,0,0,1,1,0],[1,0,1,0,0,1],[0,1,1,0,0,1],[0,1,0,1,1,0]] },
  "6 hold - 3 baner - 3 kampe": { size: 6, matrix: [[0,1,1,1,0,0],[1,0,0,0,1,1],[1,0,0,1,1,0],[1,0,1,0,0,1],[0,1,1,0,0,1],[0,1,0,1,1,0]] },
  "7 hold - 2 baner - 4 kampe": { size: 7, matrix: [[0,1,1,0,0,1,1],[1,0,1,1,1,0,0],[1,1,0,1,0,0,1],[0,1,1,0,1,1,0],[0,1,0,1,0,1,1],[1,0,0,1,1,0,1],[1,0,1,0,1,1,0]] },
  "7 hold - 2 baner - 4 kampe V.2": { size: 7, matrix: [[0,1,1,1,1,0,0],[1,0,1,1,1,0,0],[1,1,0,0,0,1,1],[1,1,0,0,0,1,1],[1,1,0,0,0,1,1],[0,0,1,1,1,0,1],[0,0,1,1,1,1,0]] },
  "7 hold - 3 baner - 3 kampe": { size: 7, matrix: [[0,1,1,0,0,1,1],[1,0,1,1,0,0,0],[1,1,0,1,0,0,0],[0,1,1,0,1,0,0],[0,0,0,1,0,1,1],[1,0,0,0,1,0,1],[1,0,0,0,1,1,0]] },
  "8 hold - 3 baner - 3 kampe": { size: 8, matrix: [[0,1,1,1,0,0,0,0],[1,0,1,1,0,0,0,0],[1,1,0,1,0,0,0,0],[1,1,1,0,0,0,0,0],[0,0,0,0,0,1,1,1],[0,0,0,0,1,0,1,1],[0,0,0,0,1,1,0,1],[0,0,0,0,1,1,1,0]] },
  "8 hold - 4 baner - 3 kampe": { size: 8, matrix: [[0,1,1,1,0,0,0,0],[1,0,1,1,0,0,0,0],[1,1,0,1,0,0,0,0],[1,1,1,0,0,0,0,0],[0,0,0,0,0,1,1,1],[0,0,0,0,1,0,1,1],[0,0,0,0,1,1,0,1],[0,0,0,0,1,1,1,0]] },
  "9 hold - 3 baner - 4 kampe": { size: 9, matrix: [[0,1,1,1,0,0,0,0,1],[1,0,1,1,0,0,0,0,1],[1,1,0,1,0,1,0,0,0],[1,1,1,0,1,0,0,0,0],[0,0,0,1,0,1,1,1,0],[0,0,1,0,1,0,1,1,0],[0,0,0,0,1,1,0,1,1],[0,0,0,0,1,1,1,0,1],[1,1,0,0,0,0,1,1,0]] },
  "9 hold - 4 baner - 3 kampe": { size: 9, matrix: [[0,1,1,0,0,0,0,0,1],[1,0,1,1,0,0,0,0,1],[1,1,0,1,0,0,0,0,0],[0,1,1,0,1,0,0,0,0],[0,0,0,1,0,1,1,0,0],[0,0,0,0,1,0,1,1,0],[0,0,0,0,1,1,0,1,0],[0,0,0,0,0,1,1,0,1],[1,1,0,0,0,0,0,1,0]] },
  "10 hold - 4 baner - 3 kampe": { size: 10, matrix: [[0,1,1,1,0,0,0,0,0,0],[1,0,1,1,0,0,0,0,0,0],[1,1,0,1,0,0,0,0,0,0],[1,1,1,0,0,0,0,0,0,0],[0,0,0,0,0,1,1,0,0,1],[0,0,0,0,1,0,1,0,1,0],[0,0,0,0,1,1,0,1,0,0],[0,0,0,0,0,0,1,0,1,1],[0,0,0,0,0,1,0,1,0,1],[0,0,0,0,1,0,0,1,1,0]] },
  "10 hold - 5 baner - 3 kampe": { size: 10, matrix: [[0,1,1,1,0,0,0,0,0,0],[1,0,1,1,0,0,0,0,0,0],[1,1,0,1,0,0,0,0,0,0],[1,1,1,0,0,0,0,0,0,0],[0,0,0,0,0,1,1,0,0,1],[0,0,0,0,1,0,1,0,1,0],[0,0,0,0,1,1,0,1,0,0],[0,0,0,0,0,0,1,0,1,1],[0,0,0,0,0,1,0,1,0,1],[0,0,0,0,1,0,0,1,1,0]] }
};

const predefinedSchedules = {
  "3 hold - 1 bane - dobbelt": [
    [[1,2]],[[2,3]],[[3,1]],[[2,1]],[[3,2]],[[1,3]]
  ],
  "4 hold - 1 bane - dobbelt": [
    [[1,2]],[[3,4]],[[3,1]],[[2,4]],[[4,1]],[[2,3]],
    [[2,1]],[[4,3]],[[1,3]],[[4,2]],[[1,4]],[[3,2]]
  ],
  "4 hold - 2 baner - 3 kampe": [
    [[1,2],[3,4]],[[3,1],[2,4]],[[4,1],[2,3]]
  ],
  "5 hold - 1 bane - 6 kampe": [
    [[1,2]],[[3,4]],[[5,1]],[[2,3]],[[4,5]],[[1,3]],[[2,4]],[[5,3]],
    [[4,1]],[[5,2]],[[2,1]],[[4,3]],[[1,5]],[[3,2]],[[4,5]]
  ],
  "5 hold - 2 baner - 3 kampe": [
    [[1,2],[3,4]],[[5,1],[2,3]],[[4,5],[1,3]],[[2,4],[3,5]]
  ],
  "6 hold - 2 baner - 3 kampe": [
    [[1,2],[3,4]],[[5,6],[1,3]],[[2,5],[4,6]],[[4,1],[3,5]],[[6,2]]
  ],
  "6 hold - 3 baner - 3 kampe": [
    [[1,2],[3,4],[5,6]],[[1,3],[2,5],[4,6]],[[4,1],[6,2],[5,3]]
  ],
  "7 hold - 2 baner - 4 kampe": [
    [[1,2],[3,4]],[[5,6],[7,1]],[[2,3],[4,5]],[[6,7],[3,1]],
    [[4,2],[5,7]],[[6,4],[3,7]],[[1,6],[2,5]]
  ],
  "7 hold - 2 baner - 4 kampe V.2": [
    [[5,7],[6,4]],[[2,3],[7,4]],[[3,1],[2,5]],[[6,7],[4,1]],
    [[4,2],[7,3]],[[1,5],[6,3]],[[5,6],[1,2]]
  ],
  "7 hold - 3 baner - 3 kampe": [
    [[1,2],[3,4],[5,6]],[[7,1],[2,3],[4,5]],[[6,7],[1,3],[2,4]],[[5,7],[6,1]]
  ],
  "8 hold - 3 baner - 3 kampe": [
    [[1,2],[3,4],[5,6]],[[7,8],[1,3],[2,4]],[[5,7],[6,8],[4,1]],[[2,3],[8,5],[6,7]]
  ],
  "8 hold - 4 baner - 3 kampe": [
    [[1,2],[3,4],[5,6],[7,8]],[[1,3],[2,4],[5,7],[6,8]],[[4,1],[2,3],[8,5],[6,7]]
  ],
  "9 hold - 3 baner - 4 kampe": [
    [[1,2],[3,4],[5,6]],[[7,8],[9,1],[2,3]],[[4,5],[6,7],[8,9]],
    [[1,3],[2,4],[5,7]],[[6,8],[9,2],[4,1]],[[3,6],[5,8],[7,9]]
  ],
  "9 hold - 4 baner - 3 kampe": [
    [[1,2],[3,4],[5,6],[7,8]],[[9,1],[2,3],[4,5],[6,7]],
    [[8,9],[3,1],[2,4],[5,7]],[[6,8],[9,2]]
  ],
  "10 hold - 4 baner - 3 kampe": [
    [[1,2],[3,4],[5,6],[7,8]],[[9,10],[1,3],[2,4],[5,7]],
    [[6,9],[8,10],[4,1],[2,3]],[[7,6],[8,9],[10,5]]
  ],
  "10 hold - 5 baner - 3 kampe": [
    [[1,2],[3,4],[5,6],[7,8],[9,10]],[[1,3],[2,4],[5,7],[6,9],[8,10]],
    [[4,1],[2,3],[7,6],[8,9],[10,5]]
  ]
};

// --- 3v3 FODA MATRICES OG KAMPPROGRAMMER ---
const fodaMatrices3v3 = {
  "3 hold - 1 bane - 4 kampe": { size: 3, matrix: [[0,2,2],[2,0,2],[2,2,0]] },
  "4 hold - 1 bane - 5 kampe": { size: 4, matrix: [[0,2,2,1],[2,0,1,2],[2,1,0,2],[1,2,2,0]] },
  "5 hold - 1 baner - 5 kampe": { size: 5, matrix: [[0,2,1,1,2],[2,0,1,1,1],[1,1,0,2,1],[1,1,2,0,1],[2,1,1,1,0]] },
  "5 hold - 2 baner - 5 kampe": { size: 5, matrix: [[0,2,1,1,2],[2,0,1,1,1],[1,1,0,2,1],[1,1,2,0,1],[2,1,1,1,0]] },
  "6 hold - 1 baner - 5 kampe": { size: 6, matrix: [[0,1,1,1,1,1],[1,0,1,1,1,1],[1,1,0,1,1,1],[1,1,1,0,1,1],[1,1,1,1,0,1],[1,1,1,1,1,0]] },
  "6 hold - 2 baner - 5 kampe": { size: 6, matrix: [[0,1,1,1,1,1],[1,0,1,1,1,1],[1,1,0,1,1,1],[1,1,1,0,1,1],[1,1,1,1,0,1],[1,1,1,1,1,0]] },
  "7 hold - 2 baner - 5 kampe": { size: 7, matrix: [[0,1,1,1,1,1,1],[1,0,1,1,1,0,1],[1,1,0,1,0,1,1],[1,1,1,0,1,1,0],[1,1,0,1,0,1,1],[1,0,1,1,1,0,1],[1,1,1,0,1,1,0]] },
  "8 hold - 2 baner - 5 kampe": { size: 8, matrix: [[0,1,1,1,0,0,1,1],[1,0,1,1,1,1,0,0],[1,1,0,1,0,1,1,0],[1,1,1,0,1,0,0,1],[0,1,0,1,0,1,1,1],[0,1,1,0,1,0,1,1],[1,0,1,0,1,1,0,1],[1,0,0,1,1,1,1,0]] },
  "9 hold - 2 baner - 5 kampe": { size: 9, matrix: [[0,1,1,0,0,1,0,1,1],[1,0,0,1,1,1,1,0,0],[1,0,0,1,0,1,1,0,1],[0,1,1,0,1,0,0,1,1],[0,1,0,1,0,1,0,1,1],[1,1,1,0,1,0,1,0,0],[0,1,1,0,0,1,0,1,1],[1,0,0,1,1,0,1,0,1],[1,0,1,1,1,0,1,1,0]] },
  "9 hold - 3 baner - 5 kampe": { size: 9, matrix: [[0,0,0,1,1,1,1,0,1],[0,0,0,1,1,1,1,1,0],[0,0,0,1,0,1,1,1,1],[1,1,1,0,1,0,1,1,0],[1,1,0,1,0,1,0,0,1],[1,1,1,0,1,0,0,0,1],[1,1,1,1,0,0,0,1,0],[0,1,1,1,0,0,1,0,1],[1,0,1,0,1,1,0,1,0]] },
  "10 hold - 3 baner - 5 kampe": { size: 10, matrix: [[0,0,0,0,1,1,1,0,1,1],[0,0,0,0,1,1,1,1,1,0],[0,0,0,0,1,1,0,1,1,1],[0,0,0,0,0,1,1,1,1,1],[1,1,1,0,0,0,0,1,0,1],[1,1,1,1,0,0,0,0,0,1],[1,1,0,1,0,0,0,1,1,0],[0,1,1,1,1,0,1,0,0,0],[1,1,1,1,0,0,1,0,0,0],[1,0,1,1,1,1,0,0,0,0]] },
};

const predefinedSchedules3v3 = {
  "3 hold - 1 bane - 4 kampe": [[[1,2]],[[3,1]],[[2,3]],[[2,1]],[[1,3]],[[3,2]]],
  "4 hold - 1 bane - 5 kampe": [[[1,2]],[[3,4]],[[3,1]],[[2,4]],[[4,1]],[[2,3]],[[2,1]],[[4,3]],[[1,3]],[[4,2]]],
  "5 hold - 1 baner - 5 kampe": [[[1,2]],[[3,4]],[[5,1]],[[2,3]],[[4,5]],[[1,3]],[[2,4]],[[5,3]],[[4,1]],[[5,2]],[[2,1]],[[4,3]],[[1,5]]],
  "5 hold - 2 baner - 5 kampe": [[[1,2],[3,4]],[[5,1],[2,3]],[[4,5],[1,3]],[[2,4],[5,3]],[[4,1],[5,2]],[[2,1],[4,3]],[[1,5]]],
  "6 hold - 1 baner - 5 kampe": [[[1,4]],[[2,5]],[[3,6]],[[2,1]],[[3,4]],[[6,5]],[[3,2]],[[6,1]],[[5,4]],[[2,6]],[[3,1]],[[4,2]],[[5,3]],[[6,4]],[[1,5]]],
  "6 hold - 2 baner - 5 kampe": [[[1,4],[2,5]],[[3,6],[2,1]],[[3,4],[6,5]],[[3,2],[6,1]],[[5,4],[2,6]],[[3,1],[4,2]],[[5,3],[6,4]],[[1,5]]],
  "7 hold - 2 baner - 5 kampe": [[[1,2],[3,4]],[[5,6],[7,1]],[[2,3],[4,5]],[[6,7],[3,1]],[[4,2],[5,7]],[[6,4],[3,7]],[[1,6],[2,5]],[[4,1],[6,3]],[[5,1],[7,2]]],
  "8 hold - 2 baner - 5 kampe": [[[1,2],[3,4]],[[5,6],[7,8]],[[3,1],[2,6]],[[4,5],[7,3]],[[6,8],[1,4]],[[2,3],[7,5]],[[4,2],[6,7]],[[5,8],[6,3]],[[7,1],[8,4]],[[5,2],[8,1]]],
  "9 hold - 2 baner - 5 kampe": [[[1,2],[3,4]],[[5,6],[9,1]],[[7,8],[2,6]],[[3,7],[4,5]],[[8,9],[2,7]],[[6,1],[8,4]],[[1,3],[9,5]],[[4,2],[6,7]],[[5,8],[9,3]],[[8,1],[9,4]],[[5,2],[3,6]],[[7,9]]],
  "9 hold - 3 baner - 5 kampe": [[[1,4],[2,5],[9,6]],[[4,7],[2,8],[3,9]],[[1,7],[5,9],[3,4]],[[1,9],[8,4],[3,6]],[[2,4],[5,6],[7,8]],[[1,5],[6,2],[9,8]],[[3,7],[1,6],[5,4]],[[7,2],[8,3]]],
  "10 hold - 3 baner - 5 kampe": [[[1,6],[2,7],[3,8]],[[6,4],[5,10],[9,2]],[[1,7],[10,3],[8,5]],[[9,1],[7,4],[2,6]],[[6,10],[5,3],[8,4]],[[10,1],[8,2],[9,7]],[[4,10],[2,5],[3,6]],[[3,9],[7,8],[1,5]],[[4,9]]],
};

const initialDefaultTemplates3v3 = {};
Object.keys(fodaMatrices3v3).forEach(key => {
  const size = fodaMatrices3v3[key].size;
  if (!initialDefaultTemplates3v3[size]) initialDefaultTemplates3v3[size] = key;
});

// Helper: check if all teams meet each other (no 0s off-diagonal)
const isAllMeetAll = (matrix) => {
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i !== j && matrix[i][j] === 0) return false;
    }
  }
  return true;
};

// Helper: find each key's last opponent in the schedule
const getLastOpponents = (templateName, matrix, schedules) => {
  let rounds = [];
  if (schedules && schedules[templateName]) {
    rounds = schedules[templateName];
  } else {
    // Generate rounds from matrix (same logic as KampprogramView)
    const baneMatch = templateName.match(/(\d+)\s*bane/i);
    const maxBaner = baneMatch ? parseInt(baneMatch[1]) : 1;
    let matches = [];
    for (let i = 0; i < matrix.length; i++) {
      for (let j = i + 1; j < matrix.length; j++) {
        if (matrix[i][j] >= 1) matches.push([i + 1, j + 1]);
        if (matrix[i][j] >= 2) {
          for (let k = 1; k < matrix[i][j]; k++) matches.push([i + 1, j + 1]);
        }
      }
    }
    const unplaced = [...matches];
    while (unplaced.length > 0) {
      let round = [];
      let teamsInRound = new Set();
      for (let i = 0; i < unplaced.length; i++) {
        if (round.length >= maxBaner) break;
        const match = unplaced[i];
        if (!teamsInRound.has(match[0]) && !teamsInRound.has(match[1])) {
          round.push(match);
          teamsInRound.add(match[0]);
          teamsInRound.add(match[1]);
          unplaced.splice(i, 1);
          i--;
        }
      }
      if (round.length === 0 && unplaced.length > 0) {
        round.push(unplaced.shift());
      }
      rounds.push(round);
    }
  }
  // Walk through all rounds and track last opponent per key
  const lastOpp = {};
  rounds.forEach(round => {
    round.forEach(([a, b]) => {
      lastOpp[a] = b;
      lastOpp[b] = a;
    });
  });
  return lastOpp;
};

// --- BANE-DATA OG FUNKTIONER ---
const CLUBS_DATA = [
  { name: "Allesø", p5: "4", p8: "0", p3: "0", comment: "" },
  { name: "Allested", p5: "2", p8: "1(2)", p3: "2", comment: "" },
  { name: "Assens", p5: "3", p8: "0", p3: "0", comment: "" },
  { name: "Aunslev", p5: "2", p8: "0", p3: "0", comment: "" },
  { name: "B 1909", p5: "4", p8: "2", p3: "3", comment: "" },
  { name: "B1913", p5: "6", p8: "4", p3: "3", comment: "kan lave 6 5:5-baner. Men skriv og hør." },
  { name: "BBB", p5: "4", p8: "1", p3: "6", comment: "" },
  { name: "Bogense G & IF", p5: "4", p8: "2", p3: "6", comment: "3 på kunst og 3 på græs" },
  { name: "Brenderup IF", p5: "2", p8: "3", p3: "(3)", comment: "" },
  { name: "Brylle", p5: "2", p8: "2", p3: "3", comment: "" },
  { name: "Båring", p5: "3", p8: "0", p3: "0", comment: "" },
  { name: "Dalby", p5: "2", p8: "2", p3: "0", comment: "" },
  { name: "Dalum IF", p5: "4", p8: "2", p3: "0", comment: "5 mands på Tingløkkeskolen - 3 og 8 mands på Dalum stadion - Har tidligere sagt at de ikke kan lave 3v3 og 8v8 stævner" },
  { name: "Ebberup", p5: "3", p8: "2", p3: "3", comment: "" },
  { name: "Egebjerg Fodbold", p5: "2", p8: "0", p3: "0", comment: "" },
  { name: "ERI", p5: "4", p8: "0", p3: "0", comment: "Placer stævner i starten af foråret og i slut efteråret" },
  { name: "FC Broby", p5: "3", p8: "7", p3: "2", comment: "" },
  { name: "Flemløse", p5: "2", p8: "0", p3: "2", comment: "Kan lave flere 3:3 baner. Tom" },
  { name: "Fjelsted Harndrup", p5: "2", p8: "0", p3: "0", comment: "" },
  { name: "Fjordager IF", p5: "6", p8: "0", p3: "5", comment: "" },
  { name: "Fraugde", p5: "4", p8: "4", p3: "2", comment: "" },
  { name: "FC Faaborg", p5: "3", p8: "2", p3: "3", comment: "" },
  { name: "Gelsted G & IF", p5: "4", p8: "0", p3: "0", comment: "" },
  { name: "Glamsbjerg IF", p5: "2", p8: "2", p3: "0", comment: "" },
  { name: "Hesselager", p5: "3", p8: "2", p3: "0", comment: "" },
  { name: "Holluf Pile-Tornbjerg IF", p5: "2", p8: "2", p3: "2", comment: "Kun 2 5M baner" },
  { name: "Højby S & G", p5: "4", p8: "4", p3: "0", comment: "" },
  { name: "Haarby IF", p5: "3", p8: "0", p3: "4", comment: "" },
  { name: "Kauslunde", p5: "2", p8: "0", p3: "0", comment: "" },
  { name: "Kerteminde BK", p5: "3", p8: "2", p3: "3", comment: "" },
  { name: "KFUM", p5: "4", p8: "0", p3: "3", comment: "" },
  { name: "Kirkeby IF", p5: "2", p8: "2", p3: "4", comment: "" },
  { name: "Korup", p5: "3", p8: "2", p3: "4", comment: "" },
  { name: "KR70", p5: "2", p8: "2", p3: "3", comment: "" },
  { name: "Krarup Espe Fodbold", p5: "2", p8: "2", p3: "3", comment: "" },
  { name: "KU BK", p5: "2 (4)", p8: "0", p3: "3", comment: "har 2 faste 5M baner - kan lave 4" },
  { name: "Kværndrup", p5: "3", p8: "3 (4)", p3: "3", comment: "Allan" },
  { name: "Langeskov IF", p5: "7", p8: "4", p3: "6", comment: "" },
  { name: "Boldklubben Marienlyst", p5: "6 (8)", p8: "8", p3: "6 mindst", comment: "Lægger oven i hinanden" },
  { name: "Marstal", p5: "3", p8: "3", p3: "0", comment: "" },
  { name: "MG & BK", p5: "7", p8: "0", p3: "4", comment: "" },
  { name: "Morud IF", p5: "3", p8: "0", p3: "0", comment: "" },
  { name: "Munkebo BK", p5: "0", p8: "2", p3: "5", comment: "" },
  { name: "Nr. Lyndelse / Søby F.C.", p5: "4", p8: "2", p3: "0", comment: "" },
  { name: "Nr. Aaby", p5: "4", p8: "0", p3: "0", comment: "" },
  { name: "Nyborg G & IF", p5: "4", p8: "4", p3: "4", comment: "" },
  { name: "Næsby BK", p5: "9", p8: "0", p3: "4", comment: "" },
  { name: "OB", p5: "2", p8: "2", p3: "4", comment: "Søndag efter kl. 12" },
  { name: "OKS", p5: "0", p8: "2", p3: "5", comment: "" },
  { name: "Ringe BK", p5: "3", p8: "2 (evt. 4)", p3: "5", comment: "" },
  { name: "Rudkøbing", p5: "4", p8: "0", p3: "0", comment: "" },
  { name: "Ryslinge BK", p5: "3", p8: "4", p3: "0", comment: "" },
  { name: "Sanderum BK", p5: "3", p8: "0", p3: "7", comment: "" },
  { name: "SfB", p5: "4", p8: "0", p3: "4", comment: "" },
  { name: "S.K.F.I.F.", p5: "0", p8: "0", p3: "3", comment: "" },
  { name: "Skårup", p5: "4", p8: "3", p3: "4", comment: "" },
  { name: "SSV Højfyn", p5: "5", p8: "4", p3: "5", comment: "" },
  { name: "Stige", p5: "2", p8: "2", p3: "3", comment: "" },
  { name: "BK Stjernen af 1968", p5: "4", p8: "2", p3: "2", comment: "" },
  { name: "Strib IF", p5: "3", p8: "4", p3: "4", comment: "" },
  { name: "SUB Ullerslev", p5: "6", p8: "0", p3: "0", comment: "" },
  { name: "Særslev", p5: "2", p8: "2", p3: "3", comment: "" },
  { name: "Søhus stige", p5: "2", p8: "6", p3: "4", comment: "" },
  { name: "Søndersø BK", p5: "3", p8: "2", p3: "0", comment: "" },
  { name: "Thurø BK af 1920", p5: "4", p8: "3", p3: "4", comment: "" },
  { name: "TIF Faaborg", p5: "2", p8: "0", p3: "0", comment: "" },
  { name: "Tommerup", p5: "4", p8: "0", p3: "0", comment: "" },
  { name: "TPI", p5: "6", p8: "6", p3: "10", comment: "Hjemmeholdene skal spille første og sidste kamp i stævnet" },
  { name: "Tved BK", p5: "2", p8: "3", p3: "0", comment: "Vil gerne kører forskellige steder hen" },
  { name: "Tåsinge f. B.", p5: "4", p8: "4", p3: "5", comment: "" },
  { name: "Ubberud", p5: "2", p8: "2", p3: "3", comment: "" },
  { name: "Verninge", p5: "4", p8: "0", p3: "0", comment: "" },
  { name: "Vindinge", p5: "2", p8: "3", p3: "4", comment: "" },
  { name: "Ø.B.", p5: "2", p8: "2", p3: "2", comment: "" },
  { name: "Aarslev BK", p5: "4", p8: "4", p3: "0", comment: "" },
  { name: "Aarup", p5: "2", p8: "1", p3: "0", comment: "" },
  { name: "FC Kurant", p5: "0", p8: "0", p3: "0", comment: "" },
  { name: "FC Odense", p5: "0", p8: "0", p3: "0", comment: "" },
  { name: "Fortuna Svendborg", p5: "0", p8: "0", p3: "0", comment: "" },
  { name: "Issø F16", p5: "0", p8: "0", p3: "0", comment: "" },
  { name: "Otterup", p5: "0", p8: "0", p3: "0", comment: "" },
  { name: "Skeby GF", p5: "0", p8: "0", p3: "0", comment: "" }
];

// Klub-alias mapping: kendte variationer → kanonisk CLUBS_DATA-navn
const CLUB_ALIASES = {
  'tpi': 'TPI', 'tarup/paarup if': 'TPI', 'tarup/paarup': 'TPI', 'tarup paarup if': 'TPI', 'tarup paarup': 'TPI',
  'mg&bk': 'MG & BK', 'mg & bk': 'MG & BK',
  'kfum': 'KFUM', 'kfum.s bk': 'KFUM', 'kfums bk': 'KFUM',
  'skfif': 'S.K.F.I.F.', 's.k.f.i.f.': 'S.K.F.I.F.', 's.k.f.i.f': 'S.K.F.I.F.',
  'sfb': 'SfB', 'stige': 'Stige', 'stige bk': 'Stige', 'stige boldklub 2017': 'Stige',
  'marienlyst': 'Boldklubben Marienlyst', 'boldklubben marienlyst': 'Boldklubben Marienlyst', 'bk marienlyst': 'Boldklubben Marienlyst',
  'næsby': 'Næsby BK', 'næsby bk': 'Næsby BK', 'nåsby': 'Næsby BK', 'nåsby bk': 'Næsby BK',
  'nyborg': 'Nyborg G & IF', 'nyborg gif': 'Nyborg G & IF', 'nyborg g & if': 'Nyborg G & IF', 'nyborg g&if': 'Nyborg G & IF',
  'vindinge': 'Vindinge', 'vindinge bk': 'Vindinge',
  'thurø': 'Thurø BK af 1920', 'thurø bk af 1920': 'Thurø BK af 1920', 'thuro bk af 1920': 'Thurø BK af 1920',
  'tøsinge': 'Tåsinge f. B.', 'tåsinge': 'Tåsinge f. B.', 'tåsinge f. b.': 'Tåsinge f. B.', 'tøsinge f. b.': 'Tåsinge f. B.', 't øsinge': 'Tåsinge f. B.',
  'dalum': 'Dalum IF', 'dalum if': 'Dalum IF',
  'fjordager': 'Fjordager IF', 'fjordager if': 'Fjordager IF',
  'strib': 'Strib IF', 'strib if': 'Strib IF',
  'ob': 'OB', 'oks': 'OKS', 'bbb': 'BBB', 'eri': 'ERI',
  'hpt': 'Holluf Pile-Tornbjerg IF', 'holluf pile-tornbjerg if': 'Holluf Pile-Tornbjerg IF', 'holluf pile': 'Holluf Pile-Tornbjerg IF',
  'søhus': 'Søhus stige', 'søhus if': 'Søhus stige', 'søhus stige': 'Søhus stige',
  'aarup': 'Aarup', 'aarup bk': 'Aarup',
  'hesselager': 'Hesselager', 'hesselager fodbold': 'Hesselager',
  'ryslinge': 'Ryslinge BK', 'ryslinge bk': 'Ryslinge BK',
  'tommerup': 'Tommerup', 'tommerup bk': 'Tommerup', 'ssv tommerup': 'Tommerup',
  'brylle': 'Brylle', 'brylle-verninge': 'Brylle',
  'egebjerg': 'Egebjerg Fodbold', 'egebjerg fodbold': 'Egebjerg Fodbold',
  'fraugde': 'Fraugde', 'korup': 'Korup',
  'nr. aaby': 'Nr. Aaby', 'nr. aaby ik': 'Nr. Aaby',
  'ø.b.': 'Ø.B.', 'øb': 'Ø.B.', 'åb': 'Ø.B.',
  'sanderum': 'Sanderum BK', 'sanderum bk': 'Sanderum BK',
  'kerteminde': 'Kerteminde BK', 'kerteminde bk': 'Kerteminde BK',
  'assens': 'Assens', 'assens fc': 'Assens',
  'skårup': 'Skårup', 'skårup if': 'Skårup',
  'ringe': 'Ringe BK', 'ringe bk': 'Ringe BK',
  'fc faaborg': 'FC Faaborg', 'fc broby': 'FC Broby',
  'kurant': 'FC Kurant', 'fc kurant': 'FC Kurant',
  'fc odense': 'FC Odense',
  'ku bk': 'KU BK', 'kubk': 'KU BK',
  'langeskov': 'Langeskov IF', 'langeskov if': 'Langeskov IF',
  'kværndrup': 'Kværndrup', 'kværndrup bk': 'Kværndrup',
  'morud': 'Morud IF', 'morud if': 'Morud IF',
  'munkebo': 'Munkebo BK', 'munkebo bk': 'Munkebo BK',
  'sub ullerslev': 'SUB Ullerslev',
  'bogense': 'Bogense G & IF', 'bogense g & if': 'Bogense G & IF',
  'b 1909': 'B 1909', 'b1913': 'B1913',
  'højby': 'Højby S & G', 'højby s & g': 'Højby S & G',
  'gelsted': 'Gelsted G & IF', 'gelsted g & if': 'Gelsted G & IF',
  'haarby': 'Haarby IF', 'haarby if': 'Haarby IF',
  'bk stjernen af 1968': 'BK Stjernen af 1968', 'bk stjernen': 'BK Stjernen af 1968', 'stjernen': 'BK Stjernen af 1968',
  'søndersø': 'Søndersø BK', 'søndersø bk': 'Søndersø BK', 'sønders bk': 'Søndersø BK', 'ssbk': 'Søndersø BK',
  'ssv højfyn': 'SSV Højfyn',
  'aarslev': 'Aarslev BK', 'aarslev bk': 'Aarslev BK',
  'nr. lyndelse / søby f.c.': 'Nr. Lyndelse / Søby F.C.', 'nr. lyndelse': 'Nr. Lyndelse / Søby F.C.',
  'fortuna svendborg': 'Fortuna Svendborg',
  'krarup espe': 'Krarup Espe Fodbold', 'krarup espe fodbold': 'Krarup Espe Fodbold',
  'brenderup': 'Brenderup IF', 'brenderup if': 'Brenderup IF',
  'tved': 'Tved BK', 'tved bk': 'Tved BK',
  'skeby': 'Skeby GF', 'skeby gf': 'Skeby GF',
  'otterup': 'Otterup', 'otterup bold- og idratsklub': 'Otterup',
  'issø f16': 'Issø F16', 'issø': 'Issø F16',
};

const normalizeClubName = (name) => {
  if (!name) return name;
  const cleaned = name.replace(/\s+/g, ' ').trim();
  const key = cleaned.toLowerCase();
  if (CLUB_ALIASES[key]) return CLUB_ALIASES[key];
  const withoutNum = key.replace(/\s+\d+$/, '');
  if (CLUB_ALIASES[withoutNum]) return CLUB_ALIASES[withoutNum];
  return cleaned;
};

const matchClubName = (name1, name2) => {
  if (!name1 || !name2) return false;
  const n1 = normalizeClubName(name1).toLowerCase();
  const n2 = normalizeClubName(name2).toLowerCase();
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
};

const parseNumber = (val) => {
  if (!val) return 0;
  const match = val.toString().match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

// Helper: get capacity field name (p3/p5/p8) from row name format
const getRowFormat = (rowName) => {
  if (rowName.includes('3:3')) return 'p3';
  if (rowName.includes('8:8')) return 'p8';
  return 'p5';
};

// Helper: extract number of baner from template name
const getBaneCountFromTemplate = (templateName) => {
  if (!templateName) return 1;
  const match = templateName.match(/(\d+)\s*bane/i);
  return match ? parseInt(match[1]) : 1;
};

// --- GEOGRAFISK DATABASE (Fynske klubber) ---
const fynPostalCoords = {
  '5000': { lat: 55.4038, lng: 10.4024 },
  '5200': { lat: 55.3959, lng: 10.3883 },
  '5210': { lat: 55.4106, lng: 10.3560 },
  '5220': { lat: 55.3870, lng: 10.4230 },
  '5230': { lat: 55.3920, lng: 10.3750 },
  '5240': { lat: 55.4168, lng: 10.4310 },
  '5250': { lat: 55.3830, lng: 10.3530 },
  '5260': { lat: 55.3700, lng: 10.3900 },
  '5270': { lat: 55.4250, lng: 10.3880 },
  '5290': { lat: 55.3970, lng: 10.5200 },
  '5300': { lat: 55.4490, lng: 10.6570 },
  '5320': { lat: 55.4130, lng: 10.4850 },
  '5330': { lat: 55.4530, lng: 10.5630 },
  '5350': { lat: 55.4400, lng: 10.5400 },
  '5370': { lat: 55.4800, lng: 10.6250 },
  '5380': { lat: 55.4000, lng: 10.5700 },
  '5390': { lat: 55.4700, lng: 10.7000 },
  '5400': { lat: 55.5660, lng: 10.0880 },
  '5450': { lat: 55.5140, lng: 10.2920 },
  '5462': { lat: 55.4900, lng: 10.2100 },
  '5463': { lat: 55.4600, lng: 9.9900 },
  '5464': { lat: 55.4800, lng: 9.9800 },
  '5466': { lat: 55.4700, lng: 10.0200 },
  '5471': { lat: 55.4830, lng: 10.2450 },
  '5474': { lat: 55.4750, lng: 10.1800 },
  '5485': { lat: 55.5100, lng: 10.1600 },
  '5491': { lat: 55.3950, lng: 10.2800 },
  '5492': { lat: 55.3800, lng: 10.2200 },
  '5500': { lat: 55.5054, lng: 9.7305 },
  '5540': { lat: 55.3500, lng: 10.6100 },
  '5550': { lat: 55.3600, lng: 10.5700 },
  '5560': { lat: 55.3920, lng: 10.0650 },
  '5580': { lat: 55.4500, lng: 9.8500 },
  '5591': { lat: 55.4350, lng: 9.9200 },
  '5592': { lat: 55.4200, lng: 9.9600 },
  '5600': { lat: 55.0960, lng: 10.2410 },
  '5610': { lat: 55.2710, lng: 9.8800 },
  '5620': { lat: 55.2850, lng: 10.0800 },
  '5631': { lat: 55.2300, lng: 9.9500 },
  '5642': { lat: 55.1400, lng: 10.1700 },
  '5672': { lat: 55.2250, lng: 10.2550 },
  '5683': { lat: 55.2200, lng: 10.0500 },
  '5690': { lat: 55.3200, lng: 10.2100 },
  '5700': { lat: 55.0597, lng: 10.6066 },
  '5750': { lat: 55.2300, lng: 10.4700 },
  '5762': { lat: 55.1200, lng: 10.4000 },
  '5771': { lat: 55.1600, lng: 10.4800 },
  '5772': { lat: 55.2100, lng: 10.5400 },
  '5792': { lat: 55.3120, lng: 10.4400 },
  '5800': { lat: 55.3125, lng: 10.7902 },
  '5853': { lat: 55.2700, lng: 10.6700 },
  '5854': { lat: 55.2500, lng: 10.5800 },
  '5856': { lat: 55.2400, lng: 10.5200 },
  '5863': { lat: 55.3000, lng: 10.5600 },
  '5871': { lat: 55.2300, lng: 10.7500 },
  '5874': { lat: 55.2000, lng: 10.7300 },
  '5881': { lat: 55.1000, lng: 10.5700 },
  '5882': { lat: 55.1200, lng: 10.6500 },
  '5883': { lat: 55.1100, lng: 10.7000 },
  '5884': { lat: 55.1500, lng: 10.7200 },
  '5892': { lat: 55.1900, lng: 10.6000 },
  '5900': { lat: 54.9393, lng: 10.7110 },
  '5932': { lat: 54.8600, lng: 10.7000 },
  '5935': { lat: 54.7500, lng: 10.6700 },
  '5953': { lat: 55.0000, lng: 10.8300 },
  '5960': { lat: 54.8550, lng: 10.5170 },
  '5970': { lat: 54.8900, lng: 10.4100 },
};

const clubGeoDatabase = {
  "Agedrup-Bullerup Boldklub": "5320",
  "Allested U & IF": "5672",
  "Allesø GF": "5270",
  "Assens FC": "5610",
  "Aunslev IF": "5800",
  "B 1909": "5240",
  "B 67": "5220",
  "B Chang": "5000",
  "B1913": "5230",
  "BBB": "5250",
  "Birkende BK": "5550",
  "BK Posten": "5000",
  "BK Stjernen af 1968": "5700",
  "BK Vestfyn": "5610",
  "BK2020": "5200",
  "Bogense G & IF": "5400",
  "Bolbro GIF": "5000",
  "Boldklubben Enghaven": "5250",
  "Boldklubben Marienlyst": "5000",
  "Brenderup IF": "5464",
  "Brylle BK": "5690",
  "Båring GF": "5466",
  "Dalby IF": "5380",
  "Dalum IF": "5250",
  "DBU Fyn": "5200",
  "Drigstrup BK": "5300",
  "DSIO": "5200",
  "Ebberup IF": "5631",
  "Egebjerg Fodbold": "5762",
  "Ejby IK": "5592",
  "ERI": "5700",
  "F.C. Lange Bolde": "5210",
  "Faldsled/Svanninge SG & IF": "5642",
  "FC Avrasya": "5000",
  "FC BiH Odense": "5220",
  "FC Broby": "5672",
  "FC Campus": "5230",
  "FC Faaborg": "5600",
  "FC Hjallese": "5000",
  "FC Kurant": "5700",
  "FC Odense": "5250",
  "FC Sydfyn": "5700",
  "FC Zagros Odense": "5220",
  "FIUK, Odense": "5240",
  "Fjelsted/Harndrup IF": "5463",
  "Fjordager IF": "5240",
  "FK Utopia": "5000",
  "Flemløse BK": "5620",
  "Fortuna Svendborg": "5700",
  "Fraugde G & IF": "5220",
  "Gelsted G & IF": "5591",
  "Get2Sport": "5240",
  "Gislev IF": "5854",
  "Glamsbjerg IF": "5620",
  "HERIF": "5853",
  "Herrested-Ørbæk Boldklub": "5853",
  "Hesselager Fodbold": "5874",
  "Holluf Pile-Tornbjerg IF": "5220",
  "Horne f. Sp.": "5600",
  "Hospitalets FK": "5500",
  "Humble BK": "5932",
  "Højby S & G": "5260",
  "Haarby Efterskole": "5683",
  "Haarby IF": "5683",
  "Hårslev BK": "5471",
  "IF 09": "5240",
  "Issø F16": "5771",
  "Kauslunde IF": "5500",
  "Kerte GF": "5560",
  "Kerteminde BK": "5300",
  "KFUM.s BK Odense": "5200",
  "Kildemosens BK": "5000",
  "Kirkeby IF": "5771",
  "Klinte Grindløse IF": "5400",
  "Korinth IF": "5600",
  "KR 70": "5300",
  "Krarup Espe Fodbold": "5750",
  "KRFK": "5450",
  "KU BK": "5210",
  "Kværndrup BK": "5772",
  "Langeskov IF": "5550",
  "Langtved SG & IF": "5540",
  "Longelse Sp.": "5900",
  "Lumby IF 88": "5270",
  "Marslev G & IF": "5290",
  "Marstal IF": "5960",
  "MG & BK": "5500",
  "Morud IF": "5462",
  "Munkebo BK": "5330",
  "Nr. Lyndelse / Søby F.C.": "5792",
  "Nr. Søby BK": "5792",
  "Nr. Aaby IK": "5580",
  "Nyborg G & IF": "5800",
  "Næsby BK": "5270",
  "OB Q": "5000",
  "Odense Boldklub": "5000",
  "OKS": "5000",
  "Ommel BK": "5960",
  "Ore Sogns GF": "5400",
  "Otterup Bold- og Idrætsklub": "5450",
  "Oure Fodbold Akademi": "5883",
  "PDIF": "5240",
  "Ringe BK": "5750",
  "Rise S & IF": "5970",
  "Rolfsted IF": "5863",
  "Rudkøbing BK": "5900",
  "Ryslinge BK": "5856",
  "Røde Stjerne": "5000",
  "S.K.F.I.F.": "5260",
  "Sanderum BK": "5250",
  "SfB": "5700",
  "Skalbjerg BK": "5492",
  "Skallebølle Sportsklub": "5492",
  "Skamby BK": "5485",
  "Skeby GF": "5450",
  "Skovby GF": "5400",
  "Skårup IF": "5881",
  "Stenstrup IF": "5771",
  "Stige Boldklub 2017": "5270",
  "Strib IF": "5500",
  "SUB Ullerslev": "5540",
  "Særslev BK": "5471",
  "Søhus IF": "5270",
  "Søllinge Sport og Fritid": "5750",
  "Søndersø BK": "5471",
  "Tarup/Paarup IF": "5210",
  "Thurø BK af 1920": "5700",
  "Tommerup BK": "5690",
  "Tranekær/Tullebølle IF": "5900",
  "Tved BK": "5700",
  "Tårup IF": "5871",
  "Tåsinge f. B.": "5700",
  "Ubberud IF": "5491",
  "University College Lillebælt Football Club": "5260",
  "Veflinge G & IF": "5474",
  "Verninge IF": "5690",
  "Vindinge BK": "5800",
  "Vissenbjerg G & IF": "5492",
  "ØB": "5000",
  "Aarslev BK": "5792",
  "Aarup BK": "5560",
  "Aasum IF": "5240",
};

const getClubCoordinates = (clubName) => {
  if (!clubName) return null;
  const postal = clubGeoDatabase[clubName];
  if (postal && fynPostalCoords[postal]) return fynPostalCoords[postal];
  const lcName = clubName.toLowerCase();
  for (const [knownClub, knownPostal] of Object.entries(clubGeoDatabase)) {
    const lcKnown = knownClub.toLowerCase();
    if (lcName === lcKnown || lcName.includes(lcKnown) || lcKnown.includes(lcName)) {
      if (fynPostalCoords[knownPostal]) return fynPostalCoords[knownPostal];
    }
  }
  return null;
};

const haversineDistance = (c1, c2) => {
  const R = 6371;
  const dLat = (c2.lat - c1.lat) * Math.PI / 180;
  const dLng = (c2.lng - c1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(c1.lat * Math.PI / 180) * Math.cos(c2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const BanerView = ({ clubs, setClubs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [min3, setMin3] = useState(0);
  const [min5, setMin5] = useState(0);
  const [min8, setMin8] = useState(0);
  const [onlyWithComments, setOnlyWithComments] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: null, name: '', p3: '', p5: '', p8: '', comment: '' });

  const handleAddClick = () => {
    setFormData({ id: null, name: '', p3: '', p5: '', p8: '', comment: '' });
    setIsModalOpen(true);
  };

  const handleEditClick = (club) => {
    setFormData({ ...club });
    setIsModalOpen(true);
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (formData.id !== null) {
      setClubs(clubs.map(c => c.id === formData.id ? formData : c));
    } else {
      setClubs([...clubs, { ...formData, id: Date.now().toString() }]);
    }
    setIsModalOpen(false);
  };

  const filteredClubs = useMemo(() => {
    return clubs.filter((club) => {
      const matchesSearch = club.name.toLowerCase().includes(searchTerm.toLowerCase());
      const p3 = parseNumber(club.p3);
      const p5 = parseNumber(club.p5);
      const p8 = parseNumber(club.p8);

      const matches3 = p3 >= min3;
      const matches5 = p5 >= min5;
      const matches8 = p8 >= min8;
      
      const matchesComments = onlyWithComments ? club.comment.trim() !== "" : true;

      return matchesSearch && matches3 && matches5 && matches8 && matchesComments;
    });
  }, [clubs, searchTerm, min3, min5, min8, onlyWithComments]);

  const sortedClubs = useMemo(() => {
    let sortableItems = [...filteredClubs];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key] || "";
        let bValue = b[sortConfig.key] || "";

        if (['p3', 'p5', 'p8'].includes(sortConfig.key)) {
          aValue = parseNumber(aValue);
          bValue = parseNumber(bValue);
        } else {
          aValue = aValue.toString().toLowerCase();
          bValue = bValue.toString().toLowerCase();
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredClubs, sortConfig]);

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (columnName) => {
    if (sortConfig.key !== columnName) {
      return <ArrowUpDown size={14} className="text-green-300 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ChevronUp size={14} className="text-green-700 ml-1 shrink-0" />
      : <ChevronDown size={14} className="text-green-700 ml-1 shrink-0" />;
  };

  const clearFilters = () => {
    setSearchTerm('');
    setMin3(0);
    setMin5(0);
    setMin8(0);
    setOnlyWithComments(false);
    setSortConfig({ key: null, direction: 'asc' });
  };

  const activeFiltersCount = (min3 > 0 ? 1 : 0) + (min5 > 0 ? 1 : 0) + (min8 > 0 ? 1 : 0) + (onlyWithComments ? 1 : 0);

  return (
    <div className="flex-1 overflow-auto p-4 md:p-8 bg-gray-50 flex flex-col items-center">
      <div className="max-w-6xl w-full space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-xl shadow-sm border border-gray-200 gap-4">
          <div className="flex items-center gap-3">
            <MapIcon size={32} className="text-green-600" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Banekapacitet</h2>
              <p className="text-gray-500 mt-1 text-sm">Oversigt over klubbernes baner for stævneplanlægning.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleAddClick}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors shadow-sm"
            >
              <Plus size={18} /> Tilføj klub
            </button>
            <div className="bg-green-50 text-green-800 border border-green-200 px-4 py-2 rounded-lg font-bold text-sm hidden sm:block">
              {filteredClubs.length} {filteredClubs.length === 1 ? 'klub' : 'klubber'} fundet
            </div>
          </div>
        </div>

        {/* Top Filtre */}
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2 text-gray-800">
              <Filter size={20} className="text-green-600"/> Filtrér klubber
            </h2>
            {activeFiltersCount > 0 && (
              <button onClick={clearFilters} className="text-sm font-bold text-gray-500 hover:text-red-600 flex items-center gap-1 transition-colors px-3 py-1.5 bg-gray-100 hover:bg-red-50 rounded-lg">
                <X size={16} /> Nulstil filtre
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 items-end">
            {/* Søg */}
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Søg på klub</label>
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="f.eks. Næsby..." 
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm font-medium"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* 3-mands filter */}
            <div>
              <div className="flex justify-between text-xs font-bold mb-1.5">
                <span className="text-gray-500 uppercase">Min. 3:3 baner</span>
                <span className="text-green-700">{min3}+</span>
              </div>
              <input 
                type="range" min="0" max="10" 
                value={min3} onChange={(e) => setMin3(Number(e.target.value))}
                className="w-full accent-green-600"
              />
            </div>

            {/* 5-mands filter */}
            <div>
              <div className="flex justify-between text-xs font-bold mb-1.5">
                <span className="text-gray-500 uppercase">Min. 5:5 baner</span>
                <span className="text-green-700">{min5}+</span>
              </div>
              <input 
                type="range" min="0" max="10" 
                value={min5} onChange={(e) => setMin5(Number(e.target.value))}
                className="w-full accent-green-600"
              />
            </div>

            {/* 8-mands filter */}
            <div>
              <div className="flex justify-between text-xs font-bold mb-1.5">
                <span className="text-gray-500 uppercase">Min. 8:8 baner</span>
                <span className="text-green-700">{min8}+</span>
              </div>
              <input 
                type="range" min="0" max="10" 
                value={min8} onChange={(e) => setMin8(Number(e.target.value))}
                className="w-full accent-green-600"
              />
            </div>

            {/* Kommentar toggle */}
            <div className="pb-1">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="w-5 h-5 accent-green-600 rounded cursor-pointer"
                  checked={onlyWithComments}
                  onChange={(e) => setOnlyWithComments(e.target.checked)}
                />
                <span className="text-xs font-bold text-gray-600 group-hover:text-gray-900 transition-colors uppercase mt-0.5">
                  Kun med kommentarer
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Tabel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {filteredClubs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search size={32} className="text-gray-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Ingen klubber fundet</h3>
              <p className="text-gray-500 mb-6">Prøv at justere dine filtre eller din søgning for at finde det du leder efter.</p>
              <button 
                onClick={clearFilters}
                className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg font-bold transition-colors"
              >
                Ryd alle filtre
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 select-none">
                    <th 
                      className="p-4 font-semibold text-gray-600 w-[20%] cursor-pointer hover:bg-gray-200 transition-colors group"
                      onClick={() => requestSort('name')}
                    >
                      <div className="flex items-center">Klubnavn {getSortIcon('name')}</div>
                    </th>
                    <th 
                      className="p-4 font-semibold text-gray-600 w-[10%] cursor-pointer hover:bg-gray-200 transition-colors group"
                      onClick={() => requestSort('p3')}
                    >
                      <div className="flex items-center justify-center">3:3 {getSortIcon('p3')}</div>
                    </th>
                    <th 
                      className="p-4 font-semibold text-gray-600 w-[10%] cursor-pointer hover:bg-gray-200 transition-colors group"
                      onClick={() => requestSort('p5')}
                    >
                      <div className="flex items-center justify-center">5:5 {getSortIcon('p5')}</div>
                    </th>
                    <th 
                      className="p-4 font-semibold text-gray-600 w-[10%] cursor-pointer hover:bg-gray-200 transition-colors group"
                      onClick={() => requestSort('p8')}
                    >
                      <div className="flex items-center justify-center">8:8 {getSortIcon('p8')}</div>
                    </th>
                    <th 
                      className="p-4 font-semibold text-gray-600 w-[50%] cursor-pointer hover:bg-gray-200 transition-colors group"
                      onClick={() => requestSort('comment')}
                    >
                      <div className="flex items-center">Kommentarer {getSortIcon('comment')}</div>
                    </th>
                    <th className="p-4 font-semibold text-gray-600 w-[10%] text-center">Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedClubs.map((club, idx) => (
                    <tr key={club.id || idx} className="hover:bg-gray-50/80 transition-colors group">
                      <td className="p-4 font-bold text-gray-800">
                        {club.name}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold ${parseNumber(club.p3) > 0 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-400 bg-gray-50 border border-gray-100'}`}>
                          {club.p3 || "0"}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold ${parseNumber(club.p5) > 0 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-400 bg-gray-50 border border-gray-100'}`}>
                          {club.p5 || "0"}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold ${parseNumber(club.p8) > 0 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-400 bg-gray-50 border border-gray-100'}`}>
                          {club.p8 || "0"}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-gray-600">
                        {club.comment ? (
                          <div className="flex items-start gap-2 bg-yellow-50 text-yellow-800 p-2.5 rounded-lg border border-yellow-200/50 text-[11px] font-medium">
                            <AlertCircle size={14} className="mt-0.5 shrink-0 text-yellow-600" />
                            <span>{club.comment}</span>
                          </div>
                        ) : (
                          <span className="text-gray-300 italic text-xs">-</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => handleEditClick(club)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors inline-flex justify-center items-center"
                          title="Rediger klub"
                        >
                          <Edit2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal / Pop-up til Tilføj/Rediger klub */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                {formData.id ? <Edit2 size={20} className="text-green-600" /> : <Plus size={20} className="text-green-600" />}
                {formData.id ? 'Rediger klub' : 'Tilføj ny klub'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Klubnavn</label>
                  <input 
                    type="text" required
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="f.eks. FC Odense"
                  />
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">3:3 baner</label>
                    <input 
                      type="text" 
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm"
                      value={formData.p3}
                      onChange={e => setFormData({...formData, p3: e.target.value})}
                      placeholder="f.eks. 2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">5:5 baner</label>
                    <input 
                      type="text" 
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm"
                      value={formData.p5}
                      onChange={e => setFormData({...formData, p5: e.target.value})}
                      placeholder="f.eks. 4"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">8:8 baner</label>
                    <input 
                      type="text" 
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm"
                      value={formData.p8}
                      onChange={e => setFormData({...formData, p8: e.target.value})}
                      placeholder="f.eks. 1(2)"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Kommentarer</label>
                  <textarea 
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition-all resize-none h-24 text-sm"
                    value={formData.comment}
                    onChange={e => setFormData({...formData, comment: e.target.value})}
                    placeholder="Evt. særlige forhold..."
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition-colors text-sm"
                >
                  Annuller
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors shadow-sm text-sm"
                >
                  Gem ændringer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const initialDefaultTemplates = {};
Object.keys(fodaMatrices).forEach(key => {
  const size = fodaMatrices[key].size;
  if (!initialDefaultTemplates[size]) initialDefaultTemplates[size] = key;
});

const defaultSpecificCriteria = { useSpecific: false, avoidSameClub: true, autoAssignHost: true, hostGetsMostMatches: true, avoidMultipleHostsOnSameDate: true, avoidPreviousHosts: true, avoidInsufficientBaneCapacity: true, prioritizeNewHostInAgeGroup: true, preferGeographicProximity: true, startTime: null };

const findNonIntersectingPair = (templateKey) => {
   const templateData = fodaMatrices[templateKey] || fodaMatrices3v3[templateKey];
   if (!templateData) return null;
   const matrix = templateData.matrix;
   for (let i = 0; i < matrix.length; i++) {
     for (let j = i + 1; j < matrix.length; j++) {
       if (matrix[i][j] === 0) return [i + 1, j + 1];
     }
   }
   return null;
};

const findAllNonIntersectingPairs = (templateKey) => {
   const templateData = fodaMatrices[templateKey] || fodaMatrices3v3[templateKey];
   if (!templateData) return [];
   const matrix = templateData.matrix;
   const pairs = [];
   for (let i = 0; i < matrix.length; i++) {
     for (let j = i + 1; j < matrix.length; j++) {
       if (matrix[i][j] === 0) pairs.push([i + 1, j + 1]);
     }
   }
   return pairs;
};

const getBestHostKey = (templateKey, customHostKeys = {}) => {
  if (customHostKeys[templateKey]) return customHostKeys[templateKey];

  const templateData = fodaMatrices[templateKey] || fodaMatrices3v3[templateKey];
  if (!templateData) return 2;
  const matrix = templateData.matrix;

  let counts = matrix.map(row => row.reduce((sum, val) => sum + val, 0));
  let maxCount = Math.max(...counts);
  let minCount = Math.min(...counts);

  if (maxCount === minCount) {
     return 2;
  }
  return counts.indexOf(maxCount) + 1;
};

// getBestHostKey3v3 fjernet - getBestHostKey håndterer begge formater via fallback til fodaMatrices3v3

const fixPoolKeys = (poolTeams, useHostMatchLogic, templateKey, customHostKeys = {}) => {
  const size = poolTeams.length;
  if(size === 0) return [];

  const validKeys = poolTeams.map(t => t.fodaKey).filter(k => k != null && k >= 1 && k <= size);
  const hasAllKeys = new Set(validKeys).size === size;

  if (hasAllKeys) {
    return poolTeams;
  }

  let newTeams = [...poolTeams];
  let availableKeys = Array.from({length: size}, (_, i) => i + 1);

  // Bevar pinnede holds nøgler først
  newTeams.forEach((t, idx) => {
    if (t.isPinned && t.fodaKey != null && t.fodaKey >= 1 && t.fodaKey <= size) {
      availableKeys = availableKeys.filter(k => k !== t.fodaKey);
    }
  });

  const host = newTeams.find(t => t.isHost && !(t.isPinned && t.fodaKey != null && t.fodaKey >= 1 && t.fodaKey <= size));

  if (host) {
    const bestKey = useHostMatchLogic ? getBestHostKey(templateKey, customHostKeys) : 1;
    const hostKey = availableKeys.includes(bestKey) ? bestKey : availableKeys[0];
    const hIdx = newTeams.findIndex(t => t.id === host.id);
    newTeams[hIdx] = { ...newTeams[hIdx], fodaKey: hostKey };
    availableKeys = availableKeys.filter(k => k !== hostKey);
  }

  // Pinnede hosts der allerede har nøgle er allerede håndteret ovenfor
  const pinnedHost = newTeams.find(t => t.isHost && t.isPinned && t.fodaKey != null && t.fodaKey >= 1 && t.fodaKey <= size);

  const remainingTeams = newTeams.filter(t => t.id !== host?.id && t.id !== pinnedHost?.id && !(t.isPinned && t.fodaKey != null && t.fodaKey >= 1 && t.fodaKey <= size));
  remainingTeams.sort((a, b) => {
    if (a.fodaKey == null && b.fodaKey == null) return 0;
    if (a.fodaKey == null) return 1;
    if (b.fodaKey == null) return -1;
    return a.fodaKey - b.fodaKey;
  });

  remainingTeams.forEach(t => {
    const idx = newTeams.findIndex(x => x.id === t.id);
    newTeams[idx] = { ...newTeams[idx], fodaKey: availableKeys.shift() };
  });

  return newTeams;
};

const recalculateAllRowKeys = (row, globalCriteria, defTemplates, customHostKeys = {}, altDefTemplates = {}, altCustomHostKeys = {}) => {
  let newTeams = [...row.teams];
  const unassigned = newTeams.filter(t => t.poolId === null).map(t => ({...t, fodaKey: null}));
  let processedTeams = [...unassigned];
  const rowIs3v3 = row.name.includes('3:3');

  row.pools.forEach(pool => {
    const poolTeams = newTeams.filter(t => t.poolId === pool.id);
    const size = poolTeams.length;

    // Bestem om denne pulje bruger et andet format end rækken
    const poolIs3v3 = pool.formatOverride ? pool.formatOverride === '3:3' : rowIs3v3;
    const usesAltFormat = poolIs3v3 !== rowIs3v3;
    const poolDefTemplates = usesAltFormat ? altDefTemplates : defTemplates;
    const poolCustomHostKeys = usesAltFormat ? altCustomHostKeys : customHostKeys;

    const tKey = (pool.templateKey && (fodaMatrices[pool.templateKey] || fodaMatrices3v3[pool.templateKey])?.size === size)
        ? pool.templateKey
        : poolDefTemplates[size];

    const isOrgMode = (pool.hostMode || 'host') === 'organizer';
    const useHostMatchLogic = isOrgMode ? false : (pool.specificCriteria?.useSpecific ? pool.specificCriteria.hostGetsMostMatches : globalCriteria.hostGetsMostMatches);
    const fixed = fixPoolKeys(poolTeams, useHostMatchLogic, tKey, poolCustomHostKeys);
    processedTeams = [...processedTeams, ...fixed];
  });

  return { ...row, teams: processedTeams };
};

const initialData = [
  { id: 'r1', name: 'U9 A dr. 5:5 - 26/10', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't1', name: 'BBB', club: 'BBB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't2', name: 'Dalum IF', club: 'Dalum IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't3', name: 'Fjordager IF 1', club: 'Fjordager IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't4', name: 'Fjordager IF 2', club: 'Fjordager IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't5', name: 'MG & BK 2', club: 'MG & BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't6', name: 'MG & BK 1', club: 'MG & BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't7', name: 'Næsby BK', club: 'Næsby BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't8', name: 'OB 1', club: 'OB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't9', name: 'OB 2', club: 'OB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't10', name: 'OKS', club: 'OKS', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't11', name: 'Tarup/Paarup IF', club: 'Tarup/Paarup IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't12', name: 'Thurø BK af 1920', club: 'Thurø BK af 1920', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r2', name: 'U9 B dr. 5:5 - 25/10 - Lør.', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't13', name: 'BK Stjernen af 1968', club: 'BK Stjernen af 1968', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't14', name: 'Tved BK', club: 'Tved BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't15', name: 'Aarslev BK', club: 'Aarslev BK', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r3', name: 'U9 B dr. 5:5 - 26/10 - Søn.', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't16', name: 'Dalum IF', club: 'Dalum IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't17', name: 'Højby S & G', club: 'Højby S & G', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't18', name: 'Haarby IF', club: 'Haarby IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't19', name: 'MG & BK 1', club: 'MG & BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't20', name: 'MG & BK 2', club: 'MG & BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't21', name: 'Morud IF', club: 'Morud IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't22', name: 'Nyborg G & IF 1', club: 'Nyborg G & IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't23', name: 'Nyborg G & IF 2', club: 'Nyborg G & IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't24', name: 'Næsby BK', club: 'Næsby BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't25', name: 'OB', club: 'OB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't26', name: 'OKS', club: 'OKS', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't27', name: 'Otterup Bold- og Idrætsklub', club: 'Otterup Bold- og Idrætsklub', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't28', name: 'Sanderum BK', club: 'Sanderum BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't29', name: 'Strib IF 1', club: 'Strib IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't30', name: 'Strib IF 2', club: 'Strib IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't31', name: 'SfB 1', club: 'SfB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't32', name: 'SfB 2', club: 'SfB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't33', name: 'Søndersø BK', club: 'Søndersø BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't34', name: 'Tarup/Paarup IF 1', club: 'Tarup/Paarup IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't35', name: 'Tarup/Paarup IF 2', club: 'Tarup/Paarup IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't36', name: 'Tåsinge f. B. 1', club: 'Tåsinge f. B.', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't37', name: 'Tåsinge f. B. 2', club: 'Tåsinge f. B.', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't38', name: 'Aarslev BK', club: 'Aarslev BK', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r4', name: 'U9 C dr. 5:5 - 26/10', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't39', name: 'B1913', club: 'B1913', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't40', name: 'Brenderup IF', club: 'Brenderup IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't41', name: 'BBB', club: 'BBB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't42', name: 'Egebjerg Fodbold', club: 'Egebjerg Fodbold', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't43', name: 'Fjordager IF', club: 'Fjordager IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't44', name: 'FC Faaborg', club: 'FC Faaborg', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't45', name: 'Glamsbjerg IF', club: 'Glamsbjerg IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't46', name: 'KU BK', club: 'KU BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't47', name: 'Krarup Espe Fodbold', club: 'Krarup Espe Fodbold', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't48', name: 'Nr. Lyndelse / Søby F.C. 1', club: 'Nr. Lyndelse / Søby F.C.', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't49', name: 'Nr. Lyndelse / Søby F.C. 2', club: 'Nr. Lyndelse / Søby F.C.', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't50', name: 'Næsby BK', club: 'Næsby BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't51', name: 'OB', club: 'OB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't52', name: 'Ryslinge BK', club: 'Ryslinge BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't53', name: 'Sanderum BK', club: 'Sanderum BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't54', name: 'S.K.F.I.F.', club: 'S.K.F.I.F.', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't55', name: 'SfB', club: 'SfB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't56', name: 'Tarup/Paarup IF', club: 'Tarup/Paarup IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't57', name: 'Tved BK', club: 'Tved BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't58', name: 'Aarslev BK', club: 'Aarslev BK', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r5', name: 'U9 D dr. 5:5 - 26/10', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't59', name: 'Dalum IF', club: 'Dalum IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't60', name: 'Ejby IK', club: 'Ejby IK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't61', name: 'Gelsted G & IF', club: 'Gelsted G & IF', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r6', name: 'U10 B dr. 5:5 - 25/10 - Lør.', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't62', name: 'Bogense G & IF', club: 'Bogense G & IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't63', name: 'Langeskov IF', club: 'Langeskov IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't64', name: 'Aarslev BK', club: 'Aarslev BK', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r7', name: 'U10 B dr. 5:5 - 26/10 - Søn.', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't65', name: 'Dalum IF', club: 'Dalum IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't66', name: 'Fjordager IF 1', club: 'Fjordager IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't67', name: 'Fjordager IF 2', club: 'Fjordager IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't68', name: 'Kerteminde BK 1', club: 'Kerteminde BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't69', name: 'Kerteminde BK 2', club: 'Kerteminde BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't70', name: 'KU BK', club: 'KU BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't71', name: 'Næsby BK 1', club: 'Næsby BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't72', name: 'Næsby BK 2', club: 'Næsby BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't73', name: 'Ringe BK', club: 'Ringe BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't74', name: 'Sanderum BK', club: 'Sanderum BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't75', name: 'SfB', club: 'SfB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't76', name: 'Søndersø BK', club: 'Søndersø BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't77', name: 'Ø.B.', club: 'Ø.B.', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r8', name: 'U10 C dr. 5:5 - 26/10', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't78', name: 'B 1909', club: 'B 1909', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't79', name: 'B1913', club: 'B1913', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't80', name: 'Brylle-Verninge', club: 'Brylle-Verninge', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't81', name: 'Egebjerg Fodbold 1', club: 'Egebjerg Fodbold', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't82', name: 'Egebjerg Fodbold 2', club: 'Egebjerg Fodbold', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't83', name: 'ERI', club: 'ERI', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't84', name: 'Gelsted G & IF', club: 'Gelsted G & IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't85', name: 'Højby S & G', club: 'Højby S & G', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't86', name: 'Boldklubben Marienlyst', club: 'Boldklubben Marienlyst', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't87', name: 'Munkebo BK', club: 'Munkebo BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't88', name: 'Otterup Bold- og Idrætsklub', club: 'Otterup Bold- og Idrætsklub', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't89', name: 'SSBK', club: 'SSBK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't90', name: 'Strib IF', club: 'Strib IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't91', name: 'Tåsinge f. B.', club: 'Tåsinge f. B.', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't92', name: 'Aarslev BK', club: 'Aarslev BK', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
  { id: 'r9', name: 'U10 D dr. 5:5 - 26/10', pools: [], columnOrder: ['unassigned'], teams: [
    { id: 't93', name: 'BBB', club: 'BBB', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't94', name: 'Holluf Pile-Tornbjerg IF', club: 'Holluf Pile-Tornbjerg IF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't95', name: 'MG & BK', club: 'MG & BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't96', name: 'Ringe BK', club: 'Ringe BK', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't97', name: 'Skeby GF', club: 'Skeby GF', poolId: null, isHost: false, isBye: false, isPinned: false },
    { id: 't98', name: 'SSV Højfyn', club: 'SSV Højfyn', poolId: null, isHost: false, isBye: false, isPinned: false },
  ]},
];

const KampprogramView = ({ templateName, matrix, schedules = predefinedSchedules }) => {
  const baneMatch = templateName.match(/(\d+)\s*bane/i);
  const maxBaner = baneMatch ? parseInt(baneMatch[1]) : 1;

  let rounds = [];

  if (schedules[templateName]) {
      rounds = schedules[templateName];
  } else {
      let matches = [];
      for (let i = 0; i < matrix.length; i++) {
         for (let j = i + 1; j < matrix.length; j++) {
            if (matrix[i][j] === 1) matches.push([i + 1, j + 1]);
         }
      }

      if (templateName.toLowerCase().includes("dobbelt")) {
         matches = [...matches, ...matches];
      }

      const unplaced = [...matches];
      
      while(unplaced.length > 0) {
          let round = [];
          let teamsInRound = new Set();
          let teamsInPrevRound = rounds.length > 0 ? new Set(rounds[rounds.length - 1].flat()) : new Set();
          
          for (let i = 0; i < unplaced.length; i++) {
              if (round.length >= maxBaner) break;
              const match = unplaced[i];
              if (!teamsInRound.has(match[0]) && !teamsInRound.has(match[1]) && !teamsInPrevRound.has(match[0]) && !teamsInPrevRound.has(match[1])) {
                  round.push(match);
                  teamsInRound.add(match[0]);
                  teamsInRound.add(match[1]);
                  unplaced.splice(i, 1);
                  i--;
              }
          }
          
          for (let i = 0; i < unplaced.length; i++) {
              if (round.length >= maxBaner) break;
              const match = unplaced[i];
              if (!teamsInRound.has(match[0]) && !teamsInRound.has(match[1])) {
                  round.push(match);
                  teamsInRound.add(match[0]);
                  teamsInRound.add(match[1]);
                  unplaced.splice(i, 1);
                  i--;
              }
          }
          
          if (round.length > 0) {
              rounds.push(round);
          } else {
              break; 
          }
      }
  }

  return (
    <div className="mt-12 bg-white p-8 rounded-xl border border-gray-200 shadow-sm w-full">
       <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-xl">
           <Calendar className="w-6 h-6 text-green-600" />
           Kampprogram (Visuel Oversigt)
       </h3>
       <p className="text-gray-600 mb-6 border-b border-gray-100 pb-4">
           Her er den rækkefølge og fordeling på baner, som dette kampprogram følger. Holdene er forsøgt fordelt så de ikke spiller to runder i træk, hvis det er muligt.
       </p>
       
       <div className="overflow-x-auto">
           <table className="w-full text-center border-collapse">
               <thead>
                   <tr>
                       <th className="p-3 bg-gray-50 border border-gray-200 text-gray-600 font-bold whitespace-nowrap">Runde \ bane</th>
                       {Array.from({length: maxBaner}).map((_, i) => (
                           <th key={i} className="p-3 bg-gray-50 border border-gray-200 text-gray-800 font-bold whitespace-nowrap min-w-[120px]">Bane {i + 1}</th>
                       ))}
                   </tr>
               </thead>
               <tbody>
                   {rounds.map((round, rIdx) => (
                       <tr key={rIdx}>
                           <td className="p-3 bg-gray-50 border border-gray-200 font-bold text-gray-800 whitespace-nowrap">Runde {rIdx + 1}</td>
                           {Array.from({length: maxBaner}).map((_, baneIdx) => {
                               const match = round[baneIdx];
                               return (
                                   <td key={baneIdx} className="p-3 border border-gray-200 bg-gray-50/50">
                                       {match ? (
                                           <div className="bg-yellow-100 border border-yellow-300 text-yellow-900 px-3 py-2 rounded-lg font-bold shadow-sm whitespace-nowrap transition-transform hover:scale-105">
                                               <Key className="w-3 h-3 inline-block mr-1 opacity-50" />
                                               {match[0]} - {match[1]}
                                           </div>
                                       ) : (
                                           <span className="text-gray-300">-</span>
                                       )}
                                   </td>
                               );
                           })}
                       </tr>
                   ))}
               </tbody>
           </table>
       </div>
    </div>
  );
};

const SortIcon = ({ columnKey, sortConfig }) => {
  if (sortConfig.key !== columnKey) return <span className="opacity-20 ml-1 inline-block"><ChevronDown className="w-3.5 h-3.5 inline-block" /></span>;
  if (sortConfig.direction === 'asc') return <ChevronUp className="w-3.5 h-3.5 inline-block ml-1 text-pink-600" />;
  return <ChevronDown className="w-3.5 h-3.5 inline-block ml-1 text-pink-600" />;
};

export default function App() {
  const [criteria, setCriteria] = useState({ avoidSameClub: true, autoAssignHost: true, hostGetsMostMatches: true, avoidMultipleHostsOnSameDate: true, avoidPreviousHosts: true, checkBaneCapacity: true, avoidInsufficientBaneCapacity: true, prioritizeNewHostInAgeGroup: true, preferGeographicProximity: true, defaultPoolStartTime: '10:00' });
  const [hostCriteriaPriority, setHostCriteriaPriority] = useState(['avoidMultipleHostsOnSameDate', 'avoidPreviousHosts', 'avoidInsufficientBaneCapacity', 'prioritizeNewHostInAgeGroup']);
  const [defaultTemplates, setDefaultTemplates] = useState(initialDefaultTemplates);
  const [customHostKeys, setCustomHostKeys] = useState({});
  const [activeTab, setActiveTab] = useState('rækker'); 
  const [previousTournaments, setPreviousTournaments] = useState([]);
  const [wishes, setWishes] = useState([]);
  const [editingWish, setEditingWish] = useState(null);
  const [clubs, setClubs] = useState(() => CLUBS_DATA.map((c, i) => ({ ...c, id: i.toString() })));

  // States til de nye ønske-filtre
  const [wishesSearchTerm, setWishesSearchTerm] = useState('');
  const [wishesFilterCategory, setWishesFilterCategory] = useState('ALL_FILTER');
  const [wishesFilterArgang, setWishesFilterArgang] = useState('ALL_FILTER');
  const [wishesFilterKoen, setWishesFilterKoen] = useState('ALL_FILTER');
  const [wishesFilterNiveau, setWishesFilterNiveau] = useState('ALL_FILTER');
  const [wishesFilterRegel, setWishesFilterRegel] = useState('ALL_FILTER');
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [collapsedWishCategories, setCollapsedWishCategories] = useState(new Set());
  const [dragWishId, setDragWishId] = useState(null);
  const [dragOverWishId, setDragOverWishId] = useState(null);

  // NYT: Sortering af ønsker
  const [wishesSortConfig, setWishesSortConfig] = useState({ key: null, direction: 'asc' });

  const [data, setData] = useState(() => initialData.map(row => recalculateAllRowKeys(row, criteria, initialDefaultTemplates, {})));
  const [activeRowId, setActiveRowId] = useState(initialData[0].id);

  // Filtrering af rækker i sidebaren
  const [rowFilterArgang, setRowFilterArgang] = useState('ALL');
  const [rowFilterNiveau, setRowFilterNiveau] = useState('ALL');
  const [rowFilterKoen, setRowFilterKoen] = useState('ALL');
  const [rowFilterFormat, setRowFilterFormat] = useState('ALL');
  const [rowFilterDato, setRowFilterDato] = useState('ALL');
  const [hideFilteredRows, setHideFilteredRows] = useState(false);
  const [rowFilterOpen, setRowFilterOpen] = useState(false);

  const [draggedTeamId, setDraggedTeamId] = useState(null);
  const [dragOverPoolId, setDragOverPoolId] = useState(null);
  const [dragOverHostPoolId, setDragOverHostPoolId] = useState(null);
  const [dragOverHeaderPoolId, setDragOverHeaderPoolId] = useState(null);
  const [dragOverSidebarRowId, setDragOverSidebarRowId] = useState(null);
  
  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);
  const wishesInputRef = useRef(null);

  const [deletePrompt, setDeletePrompt] = useState({ isOpen: false, poolId: null, poolName: '', teamCount: 0 });
  const [reshufflePrompt, setReshufflePrompt] = useState({ isOpen: false, scope: null });
  const [poolSettingsPrompt, setPoolSettingsPrompt] = useState({ isOpen: false, poolId: null, poolName: '', criteria: null });
  const [hostModePopup, setHostModePopup] = useState({ isOpen: false, poolId: null, poolName: '', currentMode: 'host', organizerClub: null });
  const [infoModal, setInfoModal] = useState({ isOpen: false, title: '', message: '' });
  const [createPoolsPrompt, setCreatePoolsPrompt] = useState({ isOpen: false, count: 1, scope: null });
  const [templatePrompt, setTemplatePrompt] = useState({ isOpen: false, poolId: null, templateKey: null });
  const [matrixPreview, setMatrixPreview] = useState({ isOpen: false, templateKey: null });
  const [multiPoolCompare, setMultiPoolCompare] = useState(null); // null eller { club }
  const [compareExpandedCols, setCompareExpandedCols] = useState(new Set());
  const [showTransferPrompt, setShowTransferPrompt] = useState(false);
  const [guideStep, setGuideStep] = useState(1); // 1-6 = aktivt trin, null = lukket
  const [guideDrag, setGuideDrag] = useState({ x: 0, y: 0 });

  const [transferTeamPrompt, setTransferTeamPrompt] = useState({ isOpen: false, teamId: null, teamName: '' });
  const [selectedTransferRow, setSelectedTransferRow] = useState("");
  
  const [renameTeamPrompt, setRenameTeamPrompt] = useState({ isOpen: false, teamId: null, currentName: '' });
  const [newTeamName, setNewTeamName] = useState("");
  
  const [deleteTeamPrompt, setDeleteTeamPrompt] = useState({ isOpen: false, teamId: null, teamName: '' });
  const [addManualRowPrompt, setAddManualRowPrompt] = useState(false);
  const [manualRowData, setManualRowData] = useState({ age: 'U9', gender: 'Drenge', level: 'A', format: '5:5', date: '', initialTeams: 0 });

  const [editRowPrompt, setEditRowPrompt] = useState(false);
  const [editRowId, setEditRowId] = useState(null);
  const [editRowData, setEditRowData] = useState({ age: '', gender: 'Drenge', level: '', format: '', date: '' });

  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  const [columnWidths, setColumnWidths] = useState({});
  const [resizeStart, setResizeStart] = useState({ x: 0, width: 0, colId: null });

  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [selectedFodaTemplate, setSelectedFodaTemplate] = useState("6 hold - 2 baner - 3 kampe");
  const [selectedFodaTemplate3v3, setSelectedFodaTemplate3v3] = useState("6 hold - 2 baner - 5 kampe");
  const [defaultTemplates3v3, setDefaultTemplates3v3] = useState(initialDefaultTemplates3v3);
  const [customHostKeys3v3, setCustomHostKeys3v3] = useState({});
  const [nøglerFormat, setNøglerFormat] = useState('5:5');
  
  const [ignoredHostConflicts, setIgnoredHostConflicts] = useState([]);
  const [ignoredPreviousHosts, setIgnoredPreviousHosts] = useState([]);
  const [ignoredBaneCapacityConflicts, setIgnoredBaneCapacityConflicts] = useState([]);
  const [ignoredHostMultiPoolConflicts, setIgnoredHostMultiPoolConflicts] = useState([]);
  const [validationModal, setValidationModal] = useState({ isOpen: false, scope: null });

  // Hjælpefunktion: genberegn en række med korrekte 3:3/5:5 skabeloner (sender begge sæt for per-pulje format-override)
  const recalcRow = (row) => {
    const is3v3 = row.name.includes('3:3');
    const templates = is3v3 ? defaultTemplates3v3 : defaultTemplates;
    const hostKeys = is3v3 ? customHostKeys3v3 : customHostKeys;
    const altTemplates = is3v3 ? defaultTemplates : defaultTemplates3v3;
    const altHostKeys = is3v3 ? customHostKeys : customHostKeys3v3;
    return recalculateAllRowKeys(row, criteria, templates, hostKeys, altTemplates, altHostKeys);
  };

  const activeRow = data.find(row => row.id === activeRowId) || data[0];

  const hostClubCounts = useMemo(() => {
    const counts = {};
    data.forEach(row => {
      row.teams.forEach(team => {
        if (team.isHost && !team.isBye && team.poolId !== null) {
          counts[team.club] = (counts[team.club] || 0) + 1;
        }
      });
    });
    return counts;
  }, [data]);

  const handleSaveProject = () => {
    const projectData = { data, criteria, defaultTemplates, customHostKeys, ignoredHostConflicts, ignoredPreviousHosts, ignoredBaneCapacityConflicts, ignoredHostMultiPoolConflicts, hostCriteriaPriority, previousTournaments, wishes, clubs, defaultTemplates3v3, customHostKeys3v3 };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'staevneplan_projekt.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadProject = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const projectData = JSON.parse(event.target.result);
        if (projectData.data) {
          const migratedData = projectData.data.map(row => ({
            ...row,
            teams: (row.teams || []).map(t => ({
              ...t,
              isPinned: t.isPinned || false
            })),
            pools: row.pools.map(p => ({
              ...p,
              hostMode: p.hostMode || 'host',
              organizerClub: p.organizerClub !== undefined ? p.organizerClub : null,
              formatOverride: p.formatOverride || null,
              specificCriteria: p.specificCriteria ? { ...p.specificCriteria, preferGeographicProximity: p.specificCriteria.preferGeographicProximity !== undefined ? p.specificCriteria.preferGeographicProximity : true, startTime: p.specificCriteria.startTime !== undefined ? p.specificCriteria.startTime : null } : undefined
            }))
          }));
          setData(migratedData);
        }
        if (projectData.criteria) setCriteria({ ...projectData.criteria, checkBaneCapacity: projectData.criteria.checkBaneCapacity ?? true, avoidInsufficientBaneCapacity: projectData.criteria.avoidInsufficientBaneCapacity ?? true, prioritizeNewHostInAgeGroup: projectData.criteria.prioritizeNewHostInAgeGroup ?? true, preferGeographicProximity: projectData.criteria.preferGeographicProximity ?? true, defaultPoolStartTime: projectData.criteria.defaultPoolStartTime ?? '10:00' });
        if (projectData.defaultTemplates) setDefaultTemplates(projectData.defaultTemplates);
        if (projectData.customHostKeys) setCustomHostKeys(projectData.customHostKeys);
        if (projectData.ignoredHostConflicts) setIgnoredHostConflicts(projectData.ignoredHostConflicts);
        if (projectData.ignoredPreviousHosts) setIgnoredPreviousHosts(projectData.ignoredPreviousHosts);
        if (projectData.ignoredBaneCapacityConflicts) setIgnoredBaneCapacityConflicts(projectData.ignoredBaneCapacityConflicts);
        if (projectData.ignoredHostMultiPoolConflicts) setIgnoredHostMultiPoolConflicts(projectData.ignoredHostMultiPoolConflicts);
        if (projectData.hostCriteriaPriority) setHostCriteriaPriority(projectData.hostCriteriaPriority);
        if (projectData.previousTournaments) setPreviousTournaments(projectData.previousTournaments);
        
        if (projectData.wishes) {
           const migratedWishes = projectData.wishes.map(w => ({
              ...w,
              kategori: w.kategori || 'Generelle ønsker',
              koen: w.koen || extractKoen(w.club || '', w.age || '', w.text || ''),
              niveauer: w.niveauer || extractNiveauer(w.age || '', w.text || ''),
              ruleType: w.ruleType || extractRuleFromText(w.text || '')
           }));
           setWishes(migratedWishes);
        }
        
        if (projectData.clubs) setClubs(projectData.clubs);
        if (projectData.defaultTemplates3v3) setDefaultTemplates3v3(projectData.defaultTemplates3v3);
        if (projectData.customHostKeys3v3) setCustomHostKeys3v3(projectData.customHostKeys3v3);

        if (projectData.data && projectData.data.length > 0) setActiveRowId(projectData.data[0].id);
      } catch (err) {
        setInfoModal({ isOpen: true, title: 'Fejl', message: 'Kunne ikke indlæse projektfilen. Er det en gyldig .json fil?' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTransferToPrevious = () => {
    let newPrev = JSON.parse(JSON.stringify(previousTournaments));
    data.forEach(row => {
      const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
      const date = dateMatch ? dateMatch[1] : 'Andre';
      const rowName = row.name.replace(/\s*-?\s*\d{1,2}\/\d{1,2}.*/, '').trim() || 'Ikke-kategoriseret';
      row.teams.forEach(team => {
        if (team.isHost && !team.isBye && team.poolId !== null) {
          const existing = newPrev.find(p => p.rowName === rowName && p.club === team.club);
          if (existing) {
            existing.count += 1;
            if (!existing.dates) existing.dates = [];
            if (date !== 'Andre' && !existing.dates.includes(date)) {
              existing.dates.push(date);
            }
          } else {
            newPrev.push({ 
               rowName, 
               club: team.club, 
               count: 1, 
               dates: date !== 'Andre' ? [date] : [] 
            });
          }
        }
      });
    });
    setPreviousTournaments(newPrev);
  };

  const executeAddManualRow = () => {
      const { age, gender, level, format, date, initialTeams } = manualRowData;
      
      let newRowName = `${age} ${gender} ${level}`;
      if (format) newRowName += ` ${format}`;
      if (date) {
         let formattedDate = date;
         if (date.includes('-')) {
             const parts = date.split('-');
             if (parts.length >= 3) {
                 formattedDate = `${parseInt(parts[2], 10)}/${parseInt(parts[1], 10)}`;
             }
         }
         newRowName += ` - ${formattedDate}`;
      }

      const newRowId = `manual_r_${Date.now()}`;
      
      const newTeams = [];
      for (let i=0; i<initialTeams; i++) {
         newTeams.push({
             id: `manual_t_${Date.now()}_${i}`,
             name: `Hold ${i+1}`,
             poolId: null,
             club: `Hold ${i+1}`,
             isHost: false,
             isBye: false,
             isPinned: false,
             fodaKey: null
         });
      }

      const newRow = {
          id: newRowId,
          name: newRowName,
          hasWarning: false,
          columnOrder: ['unassigned'],
          pools: [],
          teams: newTeams
      };

      setData(prev => [...prev, newRow]);
      setActiveRowId(newRowId);
      setAddManualRowPrompt(false);
      setManualRowData({ age: 'U9', gender: 'Drenge', level: 'A', format: '5:5', date: '', initialTeams: 0 });
  };

  const openEditRow = (row) => {
      let date = '';
      let namePart = row.name;
      if (row.name.includes(' - ')) {
          const parts = row.name.split(' - ');
          date = parts.pop().trim();
          namePart = parts.join(' - ').trim();
      }
      const words = namePart.split(' ');
      let age = words[0] || '';
      let gender = words[1] || 'Drenge';
      let level = words[2] || '';
      let format = words.slice(3).join(' ') || '';

      setEditRowData({ age, gender, level, format, date });
      setEditRowId(row.id);
      setEditRowPrompt(true);
  };

  const executeEditRow = () => {
      const { age, gender, level, format, date } = editRowData;
      let newRowName = `${age} ${gender} ${level}`.trim();
      if (format) newRowName += ` ${format}`;
      if (date) newRowName += ` - ${date}`;

      setData(prevData => prevData.map(r => r.id === editRowId ? { ...r, name: newRowName } : r));
      setEditRowPrompt(false);
      setEditRowId(null);
  };

  const handleWishesUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      const reader = new FileReader();
      reader.onload = (event) => {
          if (isExcel) {
              const wb = XLSX.read(event.target.result, { type: 'array' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
              const parsedWishes = processExcelWishes(rows);
              setWishes(prev => [...prev, ...parsedWishes]);
          } else {
              const buffer = event.target.result;
              let text = new TextDecoder('utf-8').decode(buffer);
              if (text.includes('\uFFFD')) {
                  text = new TextDecoder('windows-1252').decode(buffer);
              }
              const parsedWishes = processWishesData(text);
              setWishes(prev => [...prev, ...parsedWishes]);
          }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizing) {
        setSidebarWidth(Math.max(200, Math.min(800, e.clientX)));
      } else if (resizeStart.colId) {
        const delta = e.clientX - resizeStart.x;
        const newWidth = Math.max(200, resizeStart.width + delta);
        setColumnWidths(prev => ({ ...prev, [resizeStart.colId]: newWidth }));
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeStart({ x: 0, width: 0, colId: null });
    };

    if (isResizing || resizeStart.colId) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart]);

  const handleColResizeStart = (e, colId) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = columnWidths[colId] || (colId === 'unassigned' ? 320 : 300);
    setResizeStart({ x: e.clientX, width: currentWidth, colId });
  };

  const handleColAutoFit = (e, colId) => {
    e.stopPropagation();
    let maxLength = 0;
    let teamsInCol = [];

    if (colId === 'unassigned') {
      teamsInCol = activeRow.teams.filter(t => t.poolId === null);
      maxLength = "Ikke-fordelte".length;
    } else {
      teamsInCol = activeRow.teams.filter(t => t.poolId === colId);
      const pool = activeRow.pools.find(p => p.id === colId);
      if (pool) maxLength = pool.name.length + 8;
    }

    teamsInCol.forEach(t => {
      if (t.name.length > maxLength) maxLength = t.name.length;
    });

    const calculatedWidth = Math.min(600, Math.max(200, 120 + (maxLength * 8.5)));
    setColumnWidths(prev => ({ ...prev, [colId]: calculatedWidth }));
  };

  const handleAutoFitAllColumns = () => {
    const newWidths = { ...columnWidths };
    const colsToFit = activeRow.columnOrder || ['unassigned', ...activeRow.pools.map(p => p.id)];

    colsToFit.forEach(colId => {
      let maxLength = 0;
      let teamsInCol = [];

      if (colId === 'unassigned') {
        teamsInCol = activeRow.teams.filter(t => t.poolId === null);
        maxLength = "Ikke-fordelte".length;
      } else {
        teamsInCol = activeRow.teams.filter(t => t.poolId === colId);
        const pool = activeRow.pools.find(p => p.id === colId);
        if (pool) maxLength = pool.name.length + 8;
      }

      teamsInCol.forEach(t => {
        if (t.name.length > maxLength) maxLength = t.name.length;
      });

      newWidths[colId] = Math.min(600, Math.max(200, 120 + (maxLength * 8.5)));
    });

    setColumnWidths(newWidths);
  };

  // Henter alle aktive ønsker, der gælder for en specifik række
  const getApplicableWishes = (row) => {
    return wishes.filter(w => isWishApplicableToRow(w, row.name));
  };

  const getPoolErrors = (pool, rowTeams, overrideRow) => {
    const errors = [];
    const poolTeams = rowTeams.filter(t => t.poolId === pool.id && !t.isBye);
    const avoidSame = pool.specificCriteria?.useSpecific ? pool.specificCriteria.avoidSameClub : criteria.avoidSameClub;

    // Tjek om der er en aktiv overstyring fra ønsker: "SAME_POOL"
    const rowWishes = getApplicableWishes(overrideRow || activeRow);

    if (avoidSame) {
      const clubs = poolTeams.map(t => t.club);
      const duplicates = clubs.filter((item, index) => clubs.indexOf(item) !== index);
      if (duplicates.length > 0) {
        const uniqueDups = [...new Set(duplicates)];
        const errPoolMats = fodaMatrices[pool.templateKey] || fodaMatrices3v3[pool.templateKey];
        const currentTemplate = (pool.templateKey && errPoolMats?.size === poolTeams.length)
                    ? pool.templateKey
                    : (pool.formatOverride === '3:3' ? defaultTemplates3v3 : pool.formatOverride === '5:5' ? defaultTemplates : ((overrideRow || activeRow)?.name.includes('3:3') ? defaultTemplates3v3 : defaultTemplates))[poolTeams.length];
        const matrixData = currentTemplate ? (fodaMatrices[currentTemplate] || fodaMatrices3v3[currentTemplate])?.matrix : null;

        uniqueDups.forEach(club => {
           // Overstyring: Hvis klubben har en SAME_POOL regel, er der INGEN fejl.
           const clubHasSamePoolWish = rowWishes.some(w => w.ruleType === 'SAME_POOL' && w.club.toLowerCase() === club.toLowerCase());
           
           if (!clubHasSamePoolWish) {
              const teamsOfClub = poolTeams.filter(t => t.club === club);
              let isResolved = false;
              if (teamsOfClub.length >= 2 && matrixData) {
                 isResolved = true;
                 for(let i = 0; i < teamsOfClub.length; i++) {
                    for(let j = i + 1; j < teamsOfClub.length; j++) {
                       const k1 = teamsOfClub[i].fodaKey;
                       const k2 = teamsOfClub[j].fodaKey;
                       if (!k1 || !k2 || matrixData[k1-1][k2-1] !== 0) {
                          isResolved = false;
                       }
                    }
                 }
              }
              errors.push({
                  message: `Klubkonflikt: ${club} har flere hold.`,
                  clubs: [club],
                  resolved: isResolved
              });
           }
        });
      }
    }
    return errors;
  };

  const getRowErrors = (row) => row.pools.some(p => getPoolErrors(p, row.teams).some(e => !e.resolved));

  const getHostConflicts = (pool, row) => {
      // Arrangør-puljer har ingen vært-konflikter
      if ((pool.hostMode || 'host') === 'organizer') return { dateConflict: false, prevConflict: false };
      const poolTeams = row.teams.filter(t => t.poolId === pool.id);
      const poolHost = poolTeams.find(t => t.isHost && !t.isBye);
      if (!poolHost) return { dateConflict: false, prevConflict: false };

      const rowWishes = getApplicableWishes(row);
      const hostHasForceHostWish = rowWishes.some(w => w.ruleType === 'FORCE_HOST' && w.club.toLowerCase() === poolHost.club.toLowerCase());

      const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
      const date = dateMatch ? dateMatch[1] : 'Andre';
      
      let dateCount = 0;
      data.forEach(r => {
         const rDateMatch = r.name.match(/\d{1,2}\/\d{1,2}/);
         const rDate = rDateMatch ? rDateMatch[0] : 'Andre';
         if (rDate === date) {
            r.teams.forEach(t => {
               if (t.isHost && !t.isBye && t.poolId !== null && t.club === poolHost.club) {
                  dateCount++;
               }
            });
         }
      });

      const ignoreDateKey = `${poolHost.club}_${date}`;
      // Ignorer konflikt, hvis de er tildelt Force Host, ELLER brugeren manuelt har ignoreret dem
      const dateConflict = dateCount > 1 && !ignoredHostConflicts.includes(ignoreDateKey) && !hostHasForceHostWish;

      const rowName = row.name.replace(/\s*-?\s*\d{1,2}\/\d{1,2}.*/, '').trim() || 'Ikke-kategoriseret';
      const specific = pool.specificCriteria || { useSpecific: false };
      const avoidPrev = specific.useSpecific && specific.avoidPreviousHosts !== undefined ? specific.avoidPreviousHosts : criteria.avoidPreviousHosts;
      
      const prevEntry = previousTournaments.find(p => p.rowName === rowName && p.club === poolHost.club);
      const ignorePrevKey = `${poolHost.club}_${rowName}`;
      const prevConflict = avoidPrev && prevEntry && !ignoredPreviousHosts.includes(ignorePrevKey) && !hostHasForceHostWish;

      return {
         dateConflict,
         prevConflict,
         ignoreDateKey,
         ignorePrevKey,
         poolHost,
         dateCount,
         dateLabel: date,
         prevDates: prevEntry && prevEntry.dates ? prevEntry.dates : [],
         hasForceHostOverride: hostHasForceHostWish
      };
  };

  const collectAllConflicts = (rowsToCheck, allData = data) => {
    const conflicts = [];
    rowsToCheck.forEach(row => {
      const rowWishes = getApplicableWishes(row);
      row.pools.forEach(pool => {
        const poolTeams = row.teams.filter(t => t.poolId === pool.id && !t.isBye);
        if (poolTeams.length === 0) return;

        // 1) Klubkonflikter (samme klub i pulje)
        const poolErrors = getPoolErrors(pool, row.teams, row);
        const conflPoolIs3v3 = pool.formatOverride ? pool.formatOverride === '3:3' : row.name.includes('3:3');
        const conflPoolMats = conflPoolIs3v3 ? fodaMatrices3v3 : fodaMatrices;
        const conflPoolDefs = conflPoolIs3v3 ? defaultTemplates3v3 : defaultTemplates;
        const currentTemplate = (pool.templateKey && conflPoolMats[pool.templateKey]?.size === poolTeams.length)
          ? pool.templateKey
          : conflPoolDefs[poolTeams.length];
        poolErrors.forEach(err => {
          conflicts.push({
            type: 'CLUB_CONFLICT',
            rowId: row.id,
            rowName: row.name,
            poolId: pool.id,
            poolName: pool.name,
            message: err.message,
            resolved: err.resolved,
            clubs: err.clubs,
            templateKey: currentTemplate
          });
        });

        // 2) Værtskonflikter
        const hostConflicts = getHostConflicts(pool, row);
        if (hostConflicts.dateConflict) {
          conflicts.push({
            type: 'HOST_DATE_CONFLICT',
            rowId: row.id,
            rowName: row.name,
            poolId: pool.id,
            poolName: pool.name,
            message: `Værtsklub ${hostConflicts.poolHost.club} er vært flere gange d. ${hostConflicts.dateLabel}`,
            resolved: false,
            hostClub: hostConflicts.poolHost.club,
            ignoreDateKey: hostConflicts.ignoreDateKey
          });
        }
        if (hostConflicts.prevConflict) {
          conflicts.push({
            type: 'HOST_PREV_CONFLICT',
            rowId: row.id,
            rowName: row.name,
            poolId: pool.id,
            poolName: pool.name,
            message: `Værtsklub ${hostConflicts.poolHost.club} var også vært sidste gang`,
            resolved: false,
            hostClub: hostConflicts.poolHost.club,
            ignorePrevKey: hostConflicts.ignorePrevKey
          });
        }

        // 3) AVOID_CLUB ønskekonflikter
        const avoidWishes = rowWishes.filter(w => w.ruleType === 'AVOID_CLUB' && w.isActive !== false);
        avoidWishes.forEach(wish => {
          const wishTeamsInPool = poolTeams.filter(t => matchClubName(t.club, wish.club));
          if (wishTeamsInPool.length > 0) {
            const enemyTeamsInPool = poolTeams.filter(t => {
              const tClub = t.club.toLowerCase();
              return wish.text.toLowerCase().includes(tClub) && !wishTeamsInPool.some(wt => wt.id === t.id);
            });
            if (enemyTeamsInPool.length > 0) {
              conflicts.push({
                type: 'AVOID_CLUB_VIOLATION',
                rowId: row.id,
                rowName: row.name,
                poolId: pool.id,
                poolName: pool.name,
                message: `${wish.club} vil undgå ${enemyTeamsInPool.map(t => t.club).join(', ')}`,
                resolved: false,
                wishClub: wish.club,
                enemyTeams: enemyTeamsInPool.map(t => ({ id: t.id, name: t.name, club: t.club }))
              });
            }
          }
        });
      });
    });

    // 4) Klubber der er vært i flere puljer (på tværs af alle rækker og datoer)
    const hostAssignments = {};
    allData.forEach(r => {
      r.pools.forEach(pool => {
        const pTeams = r.teams.filter(t => t.poolId === pool.id);
        const host = pTeams.find(t => t.isHost && !t.isBye);
        if (host) {
          if (!hostAssignments[host.club]) hostAssignments[host.club] = [];
          hostAssignments[host.club].push({ rowId: r.id, rowName: r.name, poolId: pool.id, poolName: pool.name });
        }
      });
    });

    rowsToCheck.forEach(row => {
      row.pools.forEach(pool => {
        const pTeams = row.teams.filter(t => t.poolId === pool.id);
        const host = pTeams.find(t => t.isHost && !t.isBye);
        if (!host) return;

        const allLocations = hostAssignments[host.club] || [];
        const otherLocations = allLocations.filter(l => l.poolId !== pool.id);
        if (otherLocations.length > 0) {
          // Spring over hvis allerede dækket af HOST_DATE_CONFLICT for denne pulje
          const alreadyCovered = conflicts.some(c =>
            c.type === 'HOST_DATE_CONFLICT' && c.poolId === pool.id && c.hostClub === host.club
          );
          if (!alreadyCovered) {
            const multiPoolIgnoreKey = `${host.club}_multipool`;
            if (!ignoredHostMultiPoolConflicts.includes(multiPoolIgnoreKey)) {
              const othersText = otherLocations.map(l => `${l.poolName} (${l.rowName})`).join(', ');
              conflicts.push({
                type: 'HOST_MULTI_POOL',
                rowId: row.id,
                rowName: row.name,
                poolId: pool.id,
                poolName: pool.name,
                message: `Værtsklub ${host.club} er også vært i: ${othersText}`,
                resolved: false,
                hostClub: host.club,
                ignoreMultiPoolKey: multiPoolIgnoreKey
              });
            }
          }
        }
      });
    });

    // 5) Banekapacitetskonflikter - tjek om værtsklubber har nok baner
    if (criteria.checkBaneCapacity) {
      const baneAggregation = {};

      allData.forEach(r => {
        const rDateMatch = r.name.match(/\d{1,2}\/\d{1,2}/);
        const rDate = rDateMatch ? rDateMatch[0] : null;
        if (!rDate) return;

        const formatField = getRowFormat(r.name);
        const is3v3Row = r.name.includes('3:3');

        r.pools.forEach(pool => {
          const pTeams = r.teams.filter(t => t.poolId === pool.id && !t.isBye);
          if (pTeams.length === 0) return;

          // Brug arrangørklub som spillested i arrangør-tilstand, ellers værtsklubben
          const isOrgMode = (pool.hostMode || 'host') === 'organizer';
          const venueClub = isOrgMode ? pool.organizerClub : pTeams.find(t => t.isHost)?.club;
          if (!venueClub) return;

          const poolIs3v3 = pool.formatOverride ? pool.formatOverride === '3:3' : is3v3Row;
          const poolMats = poolIs3v3 ? fodaMatrices3v3 : fodaMatrices;
          const poolDefs = poolIs3v3 ? defaultTemplates3v3 : defaultTemplates;
          const currentTemplate = (pool.templateKey && poolMats[pool.templateKey]?.size === pTeams.length) ? pool.templateKey : poolDefs[pTeams.length];

          const baneCount = getBaneCountFromTemplate(currentTemplate);

          if (!baneAggregation[venueClub]) baneAggregation[venueClub] = {};
          if (!baneAggregation[venueClub][rDate]) baneAggregation[venueClub][rDate] = {};
          if (!baneAggregation[venueClub][rDate][formatField]) {
            baneAggregation[venueClub][rDate][formatField] = { totalBaner: 0, entries: [] };
          }

          baneAggregation[venueClub][rDate][formatField].totalBaner += baneCount;
          baneAggregation[venueClub][rDate][formatField].entries.push({
            rowId: r.id, rowName: r.name, poolId: pool.id, poolName: pool.name,
            baneCount, templateName: currentTemplate || 'Ukendt'
          });
        });
      });

      Object.entries(baneAggregation).forEach(([clubName, dateMap]) => {
        const clubData = clubs.find(c => matchClubName(c.name, clubName));

        Object.entries(dateMap).forEach(([date, formatMap]) => {
          Object.entries(formatMap).forEach(([formatField, { totalBaner, entries }]) => {
            const capacity = clubData ? parseNumber(clubData[formatField]) : 0;
            if (!clubData) return;

            if (totalBaner > capacity) {
              const ignoreKey = `${clubName}_${date}_${formatField}`;
              if (ignoredBaneCapacityConflicts.includes(ignoreKey)) return;

              const formatLabel = formatField === 'p3' ? '3:3' : formatField === 'p8' ? '8:8' : '5:5';

              entries.forEach(entry => {
                const isInScope = rowsToCheck.some(r => r.id === entry.rowId);
                if (!isInScope) return;

                conflicts.push({
                  type: 'BANE_CAPACITY_CONFLICT',
                  rowId: entry.rowId,
                  rowName: entry.rowName,
                  poolId: entry.poolId,
                  poolName: entry.poolName,
                  message: `Banekapacitet overskredet: ${clubName} har ${capacity} ${formatLabel}-baner, men ${totalBaner} er påkrævet d. ${date} (denne pulje bruger ${entry.baneCount})`,
                  resolved: false,
                  hostClub: clubName,
                  date,
                  formatField,
                  capacity,
                  totalBaner,
                  baneCount: entry.baneCount,
                  ignoreKey,
                  allEntries: entries
                });
              });
            }
          });
        });
      });
    }

    return conflicts;
  };

  const getFixRecommendations = (conflict, row) => {
    const recommendations = [];
    if (conflict.type === 'CLUB_CONFLICT' && !conflict.resolved) {
      // Mulighed 1: FODA nøgle-fix (par der ikke mødes)
      if (conflict.templateKey) {
        const allPairs = findAllNonIntersectingPairs(conflict.templateKey);
        allPairs.forEach((pair, idx) => {
          recommendations.push({
            label: `Tildel nøgle ${pair[0]} & ${pair[1]} (mødes ikke)`,
            action: () => handleApplyConflictFixForRow(conflict.rowId, conflict.poolId, conflict.clubs[0], pair)
          });
        });
      }
      // Mulighed 2: Flyt hold til anden pulje
      const conflictClubTeams = row.teams.filter(t => t.poolId === conflict.poolId && t.club === conflict.clubs[0] && !t.isBye);
      if (conflictClubTeams.length > 0) {
        const teamToMove = conflictClubTeams[conflictClubTeams.length - 1];
        row.pools.filter(p => p.id !== conflict.poolId).forEach(otherPool => {
          recommendations.push({
            label: `Flyt ${teamToMove.name} til ${otherPool.name}`,
            action: () => handleMoveTeamToPool(conflict.rowId, teamToMove.id, otherPool.id)
          });
        });
      }
    }
    if (conflict.type === 'HOST_DATE_CONFLICT') {
      recommendations.push({
        label: 'Accepter konflikt (ignorer)',
        action: () => setIgnoredHostConflicts(prev => [...prev, conflict.ignoreDateKey])
      });
    }
    if (conflict.type === 'HOST_PREV_CONFLICT') {
      recommendations.push({
        label: 'Accepter konflikt (ignorer)',
        action: () => setIgnoredPreviousHosts(prev => [...prev, conflict.ignorePrevKey])
      });
    }
    if (conflict.type === 'AVOID_CLUB_VIOLATION') {
      (conflict.enemyTeams || []).forEach(enemy => {
        row.pools.filter(p => p.id !== conflict.poolId).forEach(otherPool => {
          recommendations.push({
            label: `Flyt ${enemy.name} til ${otherPool.name}`,
            action: () => handleMoveTeamToPool(conflict.rowId, enemy.id, otherPool.id)
          });
        });
      });
    }
    if (conflict.type === 'BANE_CAPACITY_CONFLICT') {
      recommendations.push({
        label: 'Accepter konflikt (ignorer)',
        action: () => setIgnoredBaneCapacityConflicts(prev => [...prev, conflict.ignoreKey])
      });
      // Foreslå at skifte vært til en anden klub med nok kapacitet
      const pool = row.pools.find(p => p.id === conflict.poolId);
      if (pool) {
        const poolTeams = row.teams.filter(t => t.poolId === pool.id && !t.isBye);
        const otherTeams = poolTeams.filter(t => t.club !== conflict.hostClub);
        const formatLabel = conflict.formatField === 'p3' ? '3:3' : conflict.formatField === 'p8' ? '8:8' : '5:5';
        otherTeams.forEach(candidate => {
          const candidateClubData = clubs.find(c => matchClubName(c.name, candidate.club));
          if (candidateClubData) {
            const candidateCapacity = parseNumber(candidateClubData[conflict.formatField]);
            if (candidateCapacity >= conflict.baneCount) {
              recommendations.push({
                label: `Skift vært til ${candidate.club} (${candidateCapacity} ${formatLabel}-baner)`,
                action: () => handleChangeHost(conflict.rowId, conflict.poolId, candidate.id)
              });
            }
          }
        });
      }
    }
    if (conflict.type === 'HOST_MULTI_POOL') {
      recommendations.push({
        label: 'Accepter konflikt (ignorer)',
        action: () => setIgnoredHostMultiPoolConflicts(prev => [...prev, conflict.ignoreMultiPoolKey])
      });
      // Foreslå at skifte vært til et andet hold i puljen
      const pool = row.pools.find(p => p.id === conflict.poolId);
      if (pool) {
        const poolTeams = row.teams.filter(t => t.poolId === pool.id && !t.isBye && !t.isHost);
        poolTeams.forEach(candidate => {
          const candidateIsHostElsewhere = data.some(r =>
            r.teams.some(t => t.club === candidate.club && t.isHost && !t.isBye && t.poolId !== pool.id)
          );
          if (!candidateIsHostElsewhere) {
            recommendations.push({
              label: `Skift vært til ${candidate.name}`,
              action: () => handleChangeHost(conflict.rowId, conflict.poolId, candidate.id)
            });
          }
        });
      }
    }
    return recommendations;
  };

  const handleApplyConflictFixForRow = (rowId, poolId, clubName, pair) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== rowId) return row;
      const newTeams = [...row.teams];
      const poolTeams = newTeams.filter(t => t.poolId === poolId);
      const conflictTeams = poolTeams.filter(t => t.club === clubName && !t.isBye).slice(0, 2);
      const restTeams = poolTeams.filter(t => !conflictTeams.includes(t));
      if (conflictTeams.length === 2) {
        const availableKeys = Array.from({length: poolTeams.length}, (_, i) => i + 1).filter(k => k !== pair[0] && k !== pair[1]);
        const updatedTeams = new Map();
        updatedTeams.set(conflictTeams[0].id, { ...conflictTeams[0], fodaKey: pair[0] });
        updatedTeams.set(conflictTeams[1].id, { ...conflictTeams[1], fodaKey: pair[1] });
        restTeams.forEach(t => { updatedTeams.set(t.id, { ...t, fodaKey: availableKeys.shift() }); });
        poolTeams.forEach(pt => {
          const idx = newTeams.findIndex(t => t.id === pt.id);
          newTeams[idx] = updatedTeams.get(pt.id) || { ...pt };
        });
      }
      return recalcRow({...row, teams: newTeams});
    }));
  };

  const handleMoveTeamToPool = (rowId, teamId, targetPoolId) => {
    clearBaneCapacityIgnoresForRow(rowId);
    setData(prevData => prevData.map(row => {
      if (row.id !== rowId) return row;
      const newTeams = row.teams.map(t =>
        t.id === teamId ? { ...t, poolId: targetPoolId, isHost: false } : t
      );
      return recalcRow({ ...row, teams: newTeams });
    }));
  };

  const handleChangeHost = (rowId, poolId, newHostTeamId) => {
    clearBaneCapacityIgnoresForRow(rowId);
    setData(prevData => prevData.map(row => {
      if (row.id !== rowId) return row;
      const newTeams = row.teams.map(t => {
        if (t.poolId === poolId && t.isHost) return { ...t, isHost: false };
        if (t.id === newHostTeamId) return { ...t, isHost: true };
        return t;
      });
      return recalcRow({ ...row, teams: newTeams });
    }));
  };

  const clearBaneCapacityIgnoresForRow = (rowId) => {
    setIgnoredBaneCapacityConflicts(prev => {
      if (prev.length === 0) return prev;
      const row = data.find(r => r.id === rowId);
      if (!row) return prev;
      const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
      if (!dateMatch) return prev;
      const date = dateMatch[1];
      const formatField = getRowFormat(row.name);
      const suffix = `_${date}_${formatField}`;
      return prev.filter(key => !key.endsWith(suffix));
    });
    // Ryd også HOST_MULTI_POOL ignores når vært ændres
    setIgnoredHostMultiPoolConflicts(prev => {
      if (prev.length === 0) return prev;
      return [];
    });
  };

  const handleNavigateToPool = (rowId, poolId) => {
    setActiveRowId(rowId);
    setActiveTab('rækker');
    setValidationModal({ isOpen: false, scope: null });
    setTimeout(() => {
      const el = document.getElementById(`pool-col-${poolId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 150);
  };

  const handleDragStart = (e, teamId) => {
    setDraggedTeamId(teamId);
    e.dataTransfer.setData('text/plain', `team:${teamId}`);
    setTimeout(() => { e.target.style.opacity = '0.5'; }, 0);
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedTeamId(null);
    setDragOverPoolId(null);
    setDragOverHostPoolId(null);
    setDragOverSidebarRowId(null);
  };

  const handleDragOver = (e, poolId) => { e.preventDefault(); setDragOverPoolId(poolId); };

  const handleTeamReorderDrop = (e, targetPoolId, dropTargetTeamId) => {
    e.preventDefault();
    e.stopPropagation();
    const payload = e.dataTransfer.getData('text/plain');
    if (payload.startsWith('key:')) return; 
    if (!payload.startsWith('team:')) return;
    const sourceTeamId = payload.split(':')[1];

    setData(prevData => prevData.map(row => {
        if (row.id !== activeRowId) return row;
        const newTeams = [...row.teams];
        
        const sourceIdx = newTeams.findIndex(t => t.id === sourceTeamId);
        if (sourceIdx === -1) return row;

        const teamToMove = { ...newTeams[sourceIdx], poolId: targetPoolId, isHost: false }; 
        newTeams.splice(sourceIdx, 1);
        
        if (dropTargetTeamId) {
            const targetIdx = newTeams.findIndex(t => t.id === dropTargetTeamId);
            if (targetIdx !== -1) {
                newTeams.splice(targetIdx, 0, teamToMove);
            } else {
                newTeams.push(teamToMove);
            }
        } else {
            newTeams.push(teamToMove);
        }
        
        return recalcRow({ ...row, teams: newTeams });
    }));
    setDragOverPoolId(null);
  };

  const handleDropAsHost = (e, targetPoolId) => {
    e.preventDefault();
    e.stopPropagation();
    // Bloker drop hvis puljen er i arrangør-tilstand
    const activeRowData = data.find(r => r.id === activeRowId);
    const targetPool = activeRowData?.pools.find(p => p.id === targetPoolId);
    if (targetPool && (targetPool.hostMode || 'host') === 'organizer') return;
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload.startsWith('team:')) return;
    const teamId = payload.split(':')[1];
    clearBaneCapacityIgnoresForRow(activeRowId);
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      let newTeams = [...row.teams];
      
      const sourceIdx = newTeams.findIndex(t => t.id === teamId);
      if (sourceIdx === -1) return row;
      
      newTeams = newTeams.map(t => t.poolId === targetPoolId && t.isHost ? { ...t, isHost: false } : t);
      
      const updatedIdx = newTeams.findIndex(t => t.id === teamId);
      newTeams[updatedIdx] = { ...newTeams[updatedIdx], poolId: targetPoolId, isHost: true };
      
      return recalcRow({ ...row, teams: newTeams });
    }));
    setDragOverHostPoolId(null);
  };

  const handleKeyDrop = (e, targetTeamId) => {
    e.preventDefault();
    e.stopPropagation();
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload.startsWith('key:')) return;
    const sourceTeamId = payload.split(':')[1];
    if (sourceTeamId === targetTeamId) return;

    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      const newTeams = [...row.teams];
      const sourceIdx = newTeams.findIndex(t => t.id === sourceTeamId);
      const targetIdx = newTeams.findIndex(t => t.id === targetTeamId);

      if (sourceIdx === -1 || targetIdx === -1) return row;

      if (newTeams[sourceIdx].poolId !== newTeams[targetIdx].poolId) return row;

      const tempKey = newTeams[sourceIdx].fodaKey;
      newTeams[sourceIdx] = { ...newTeams[sourceIdx], fodaKey: newTeams[targetIdx].fodaKey };
      newTeams[targetIdx] = { ...newTeams[targetIdx], fodaKey: tempKey };

      return recalcRow({ ...row, teams: newTeams });
    }));
  };

  const handleSidebarRowDrop = (e, targetRowId) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload.startsWith('team:')) return;
    const teamId = payload.split(':')[1];
    
    if (targetRowId === activeRowId) return; // Ignore if dropped on the currently active row (handled normally)

    setData(prevData => {
        let newData = [...prevData];
        let sourceRowIndex = -1;
        let teamToMove = null;
        
        for (let i = 0; i < newData.length; i++) {
            const t = newData[i].teams.find(x => x.id === teamId);
            if (t) {
                sourceRowIndex = i;
                teamToMove = t;
                break;
            }
        }
        
        const targetRowIndex = newData.findIndex(r => r.id === targetRowId);

        if (sourceRowIndex > -1 && targetRowIndex > -1 && sourceRowIndex !== targetRowIndex) {
            let sourceRow = { ...newData[sourceRowIndex] };
            sourceRow.teams = sourceRow.teams.filter(t => t.id !== teamId);
            newData[sourceRowIndex] = recalcRow(sourceRow);

            let targetRow = { ...newData[targetRowIndex] };
            targetRow.teams = [...targetRow.teams, { ...teamToMove, poolId: null, fodaKey: null, isHost: false }];
            newData[targetRowIndex] = recalcRow(targetRow);
        }
        return newData;
    });
    setDragOverSidebarRowId(null);
  };

  const handlePoolDragStart = (e, colId) => {
    e.dataTransfer.setData('text/plain', `col:${colId}`);
    setTimeout(() => { e.target.closest('.pool-container').style.opacity = '0.5'; }, 0);
  };

  const handlePoolDragEnd = (e) => {
    e.target.closest('.pool-container').style.opacity = '1';
    setDragOverHeaderPoolId(null);
  };

  const handlePoolDragOver = (e, colId) => {
    e.preventDefault();
    setDragOverHeaderPoolId(colId);
  };

  const handlePoolDrop = (e, targetColId) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload.startsWith('col:')) return;

    const sourceColId = payload.split(':')[1];
    if (sourceColId !== targetColId) {
      setData(prevData => prevData.map(row => {
        if (row.id !== activeRowId) return row;
        
        const currentOrder = row.columnOrder || ['unassigned', ...row.pools.map(p => p.id)];
        const newOrder = [...currentOrder];
        
        const sourceIndex = newOrder.indexOf(sourceColId);
        const targetIndex = newOrder.indexOf(targetColId);
        
        if (sourceIndex > -1 && targetIndex > -1) {
          const [movedCol] = newOrder.splice(sourceIndex, 1);
          newOrder.splice(targetIndex, 0, movedCol);
        }
        
        return { ...row, columnOrder: newOrder };
      }));
    }
    setDragOverHeaderPoolId(null);
  };

  const handleAddPool = () => {
    const newPoolId = `p${Date.now()}`;
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      const currentOrder = row.columnOrder || ['unassigned', ...row.pools.map(p => p.id)];
      return {
        ...row,
        columnOrder: [...currentOrder, newPoolId],
        pools: [...row.pools, { id: newPoolId, name: `Pulje ${row.pools.length + 1}`, specificCriteria: { ...defaultSpecificCriteria }, hostMode: 'host', organizerClub: null, formatOverride: null }]
      };
    }));
  };

  const handleRenamePool = (poolId, newName) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      return {
        ...row,
        pools: row.pools.map(p => p.id === poolId ? { ...p, name: newName } : p)
      };
    }));
  };

  const handleAddBye = (poolId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      const newByeTeam = {
        id: `bye_${Date.now()}_${Math.random()}`,
        name: 'Oversidder',
        poolId: poolId,
        club: `Oversidder_System_${Date.now()}`,
        isHost: false,
        isBye: true,
        isPinned: false,
        fodaKey: null
      };
      return recalcRow({ ...row, teams: [...row.teams, newByeTeam] });
    }));
  };

  const handleDeleteTeam = (teamId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      return recalcRow({ ...row, teams: row.teams.filter(t => t.id !== teamId) });
    }));
  };

  const executeTransferTeam = (targetRowId) => {
    const { teamId } = transferTeamPrompt;
    setData(prevData => {
      let newData = [...prevData];
      const sourceRowIndex = newData.findIndex(r => r.id === activeRowId);
      const targetRowIndex = newData.findIndex(r => r.id === targetRowId);

      if (sourceRowIndex > -1 && targetRowIndex > -1) {
        const teamToMove = newData[sourceRowIndex].teams.find(t => t.id === teamId);
        if (teamToMove) {
          let sourceRow = { ...newData[sourceRowIndex] };
          sourceRow.teams = sourceRow.teams.filter(t => t.id !== teamId);
          newData[sourceRowIndex] = recalcRow(sourceRow);

          let targetRow = { ...newData[targetRowIndex] };
          targetRow.teams = [...targetRow.teams, { ...teamToMove, poolId: null, fodaKey: null, isHost: false }];
          newData[targetRowIndex] = recalcRow(targetRow);
        }
      }
      return newData;
    });
    setTransferTeamPrompt({ isOpen: false, teamId: null, teamName: '' });
  };
  
  const executeRenameTeam = () => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      let newTeams = row.teams.map(t => t.id === renameTeamPrompt.teamId ? { ...t, name: newTeamName || 'Oversidder', club: newTeamName || 'Oversidder' } : t);
      return recalcRow({ ...row, teams: newTeams });
    }));
    setRenameTeamPrompt({ isOpen: false, teamId: null, currentName: '' });
  };

  const handleMakePermanent = (teamId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      let newTeams = row.teams.map(t => t.id === teamId ? { ...t, isBye: false } : t);
      return recalcRow({ ...row, teams: newTeams });
    }));
  };

  const handleTogglePin = (teamId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      return { ...row, teams: row.teams.map(t =>
        t.id === teamId ? { ...t, isPinned: !t.isPinned } : t
      )};
    }));
  };

  const handleTogglePinForRow = (rowId, teamId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== rowId) return row;
      return { ...row, teams: row.teams.map(t =>
        t.id === teamId ? { ...t, isPinned: !t.isPinned } : t
      )};
    }));
  };

  const moveTeamToPoolForRow = (rowId, teamId, targetPoolId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== rowId) return row;
      const newTeams = row.teams.map(t =>
        t.id === teamId ? { ...t, poolId: targetPoolId, isHost: false } : t
      );
      return recalcRow({ ...row, teams: newTeams });
    }));
  };

  const openHostModePopup = (pool) => {
    setHostModePopup({
      isOpen: true, poolId: pool.id, poolName: pool.name,
      currentMode: pool.hostMode || 'host',
      organizerClub: pool.organizerClub || null
    });
  };

  const saveHostMode = () => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      let newTeams = [...row.teams];
      // Hvis man skifter til arrangør-tilstand: fjern isHost fra nuværende vært
      if (hostModePopup.currentMode === 'organizer') {
        newTeams = newTeams.map(t =>
          t.poolId === hostModePopup.poolId && t.isHost
            ? { ...t, isHost: false } : t
        );
      }
      return recalcRow({
        ...row, teams: newTeams,
        pools: row.pools.map(p => p.id === hostModePopup.poolId
          ? { ...p,
              hostMode: hostModePopup.currentMode,
              organizerClub: hostModePopup.currentMode === 'organizer'
                ? hostModePopup.organizerClub : null }
          : p)
      });
    }));
    setHostModePopup({ isOpen: false, poolId: null, poolName: '', currentMode: 'host', organizerClub: null });
  };

  const openPoolSettings = (pool) => {
    setPoolSettingsPrompt({
      isOpen: true, poolId: pool.id, poolName: pool.name, criteria: pool.specificCriteria || { ...defaultSpecificCriteria }
    });
  };

  const savePoolSettings = () => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      return recalcRow({
        ...row,
        pools: row.pools.map(p => p.id === poolSettingsPrompt.poolId ? { ...p, specificCriteria: poolSettingsPrompt.criteria } : p)
      });
    }));
    setPoolSettingsPrompt({ isOpen: false, poolId: null, poolName: '', criteria: null });
  };

  const handleResetKeys = (poolId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      let newTeams = [...row.teams];
      newTeams = newTeams.map(t => t.poolId === poolId ? { ...t, fodaKey: null } : t);
      return recalcRow({ ...row, teams: newTeams });
    }));
  };

  const handleApplyConflictFix = (poolId, clubName, pair) => {
    handleApplyConflictFixForRow(activeRowId, poolId, clubName, pair);
  };

  const handleTemplateSelect = (poolId, templateKey) => {
      setTemplatePrompt({ isOpen: true, poolId, templateKey });
  };

  const confirmTemplateChange = (updateKeys) => {
     const { poolId, templateKey } = templatePrompt;
     setData(prevData => prevData.map(row => {
         if (row.id !== activeRowId) return row;
         let newPools = row.pools.map(p => p.id === poolId ? { ...p, templateKey } : p);
         let newTeams = [...row.teams];
         if (updateKeys) {
             newTeams = newTeams.map(t => t.poolId === poolId ? { ...t, fodaKey: null } : t);
         }
         return recalcRow({ ...row, pools: newPools, teams: newTeams });
     }));
     setTemplatePrompt({ isOpen: false, poolId: null, templateKey: null });
  };

  const handlePoolFormatToggle = (poolId) => {
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      const pool = row.pools.find(p => p.id === poolId);
      if (!pool) return row;
      const rowIs3v3 = row.name.includes('3:3');
      const currentIs3v3 = pool.formatOverride ? pool.formatOverride === '3:3' : rowIs3v3;
      // Skift til det modsatte format (eller nulstil hvis det er det samme som rækkens)
      const newIs3v3 = !currentIs3v3;
      const newOverride = newIs3v3 === rowIs3v3 ? null : (newIs3v3 ? '3:3' : '5:5');
      // Nulstil templateKey og fodaKeys da formatet ændres
      let newPools = row.pools.map(p => p.id === poolId ? { ...p, formatOverride: newOverride, templateKey: null } : p);
      let newTeams = row.teams.map(t => t.poolId === poolId ? { ...t, fodaKey: null } : t);
      return recalcRow({ ...row, pools: newPools, teams: newTeams });
    }));
  };

  const handleSetDefaultTemplate =(sizeStr, templateName) => {
     const size = parseInt(sizeStr);
     const newDefaults = { ...defaultTemplates, [size]: templateName };
     setDefaultTemplates(newDefaults);
     setData(prevData => prevData.map(row => {
       const is3v3 = row.name.includes('3:3');
       return recalculateAllRowKeys(row, criteria, is3v3 ? defaultTemplates3v3 : newDefaults, is3v3 ? customHostKeys3v3 : customHostKeys, is3v3 ? newDefaults : defaultTemplates3v3, is3v3 ? customHostKeys : customHostKeys3v3);
     }));
  };

  const handleCustomHostKeyChange = (templateKey, newKey) => {
     const newCustomKeys = { ...customHostKeys, [templateKey]: newKey };
     setCustomHostKeys(newCustomKeys);
     setData(prevData => prevData.map(row => {
       const is3v3 = row.name.includes('3:3');
       return recalculateAllRowKeys(row, criteria, is3v3 ? defaultTemplates3v3 : defaultTemplates, is3v3 ? customHostKeys3v3 : newCustomKeys, is3v3 ? defaultTemplates : defaultTemplates3v3, is3v3 ? newCustomKeys : customHostKeys3v3);
     }));
  };

  const handleSetDefaultTemplate3v3 = (sizeStr, templateName) => {
     const size = parseInt(sizeStr);
     const newDefaults3v3 = { ...defaultTemplates3v3, [size]: templateName };
     setDefaultTemplates3v3(newDefaults3v3);
     setData(prevData => prevData.map(row => {
       const is3v3 = row.name.includes('3:3');
       return recalculateAllRowKeys(row, criteria, is3v3 ? newDefaults3v3 : defaultTemplates, is3v3 ? customHostKeys3v3 : customHostKeys, is3v3 ? defaultTemplates : newDefaults3v3, is3v3 ? customHostKeys : customHostKeys3v3);
     }));
  };

  const handleCustomHostKeyChange3v3 = (templateKey, newKey) => {
     const newCustomKeys3v3 = { ...customHostKeys3v3, [templateKey]: newKey };
     setCustomHostKeys3v3(newCustomKeys3v3);
     setData(prevData => prevData.map(row => {
       const is3v3 = row.name.includes('3:3');
       return recalculateAllRowKeys(row, criteria, is3v3 ? defaultTemplates3v3 : defaultTemplates, is3v3 ? newCustomKeys3v3 : customHostKeys, is3v3 ? defaultTemplates : defaultTemplates3v3, is3v3 ? customHostKeys : newCustomKeys3v3);
     }));
  };

  const confirmDeletePool = (poolId, poolName, teamCount) => setDeletePrompt({ isOpen: true, poolId, poolName, teamCount });

  const executeDeletePool = (action) => {
    const { poolId } = deletePrompt;
    setData(prevData => prevData.map(row => {
      if (row.id !== activeRowId) return row;
      
      const remainingPools = row.pools.filter(p => p.id !== poolId);
      const newOrder = (row.columnOrder || ['unassigned', ...row.pools.map(p => p.id)]).filter(id => id !== poolId);
      
      let newTeams = [...row.teams];
      const teamsToMove = newTeams.filter(t => t.poolId === poolId);
      
      if (action === 'unassigned' || remainingPools.length === 0) {
         newTeams = newTeams.map(t => t.poolId === poolId ? { ...t, poolId: null, isHost: false } : t);
      } else if (action === 'distribute') {
         const shuffled = [...teamsToMove].sort(() => Math.random() - 0.5);
         const remainingPoolIds = remainingPools.map(p => p.id);
         const unaffectedTeams = newTeams.filter(t => t.poolId !== poolId);
         const reassignedTeams = shuffled.map((team, index) => {
            return { ...team, poolId: remainingPoolIds[index % remainingPoolIds.length], isHost: false };
         });
         newTeams = [...unaffectedTeams, ...reassignedTeams];
      }
      return recalcRow({ ...row, pools: remainingPools, columnOrder: newOrder, teams: newTeams });
    }));
    setDeletePrompt({ isOpen: false, poolId: null, poolName: '', teamCount: 0 });
  };

  const applyRandomizationToRow = (row, mode, globalCriteria, allRowsData, previousHistory) => {
    if (row.pools.length === 0) return row;
    
    // Hent gældende ønsker for denne række
    const applicableWishes = getApplicableWishes(row);

    let teamsToShuffle = [];
    let teamsToKeep = [];

    if (mode === 'all') {
      // Pinnede hold bevares altid i deres pulje med deres rolle
      teamsToShuffle = row.teams.filter(t => !t.isPinned && !t.isBye).map(t => ({ ...t, poolId: null, isHost: false }));
      teamsToKeep = row.teams.filter(t => t.isPinned && !t.isBye).map(t => ({ ...t }));
    } else {
      teamsToShuffle = row.teams.filter(t => t.poolId === null).map(t => ({ ...t, isHost: false }));
      teamsToKeep = row.teams.filter(t => t.poolId !== null).map(t => ({ ...t }));
    }

    const shuffled = [...teamsToShuffle].sort(() => Math.random() - 0.5);
    let newTeams = [...teamsToKeep, ...shuffled]; 

    const poolData = row.pools.map(p => {
      const specific = p.specificCriteria || { useSpecific: false };
      return {
        id: p.id,
        teamsCount: teamsToKeep.filter(t => t.poolId === p.id).length,
        clubSet: new Set(teamsToKeep.filter(t => t.poolId === p.id && !t.isBye).map(t => t.club)),
        avoidSameClub: specific.useSpecific ? specific.avoidSameClub : globalCriteria.avoidSameClub,
        autoAssignHost: specific.useSpecific ? specific.autoAssignHost : globalCriteria.autoAssignHost
      };
    });

    // === PHASE 1: SELECT HOST CLUBS FIRST (before distributing teams) ===
    const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
    const dateLabel = dateMatch ? dateMatch[1] : null;
    const rowName = row.name.replace(/\s*-?\s*\d{1,2}\/\d{1,2}.*/, '').trim() || 'Ikke-kategoriseret';

    const existingHostsOnDate = new Set();
    if (allRowsData && dateLabel) {
      allRowsData.forEach(r => {
        if (r.id === row.id) return;
        const rDateMatch = r.name.match(/\d{1,2}\/\d{1,2}/);
        if (rDateMatch && rDateMatch[0] === dateLabel) {
          r.teams.forEach(t => {
            if (t.isHost && t.poolId !== null && !t.isBye) {
              existingHostsOnDate.add(t.club);
            }
          });
        }
      });
    }

    teamsToKeep.forEach(t => {
      if (t.isHost && t.poolId !== null && !t.isBye) {
        existingHostsOnDate.add(t.club);
      }
    });

    const hostsChosen = new Map();
    const chosenHostIds = new Set();
    const totalRealTeams = shuffled.filter(t => !t.isBye).length + teamsToKeep.filter(t => !t.isBye).length;
    const estimatedPoolSize = Math.max(1, Math.ceil(totalRealTeams / row.pools.length));

    row.pools.forEach(pool => {
      if ((pool.hostMode || 'host') === 'organizer') return;
      const pData = poolData.find(pd => pd.id === pool.id);
      if (!pData || !pData.autoAssignHost) return;

      const pinnedHost = teamsToKeep.find(t => t.poolId === pool.id && t.isHost && !t.isBye);
      if (pinnedHost) return;

      let potentialHosts = shuffled.filter(t => !t.isBye && !chosenHostIds.has(t.id));
      if (potentialHosts.length === 0) return;

      potentialHosts = potentialHosts.filter(t => {
        const tWishes = applicableWishes.filter(w => matchClubName(t.club, w.club));
        return !tWishes.some(w => w.ruleType === 'AVOID_HOST');
      });

      const forcedHosts = potentialHosts.filter(t => {
        const tWishes = applicableWishes.filter(w => matchClubName(t.club, w.club));
        return tWishes.some(w => w.ruleType === 'FORCE_HOST');
      });

      if (forcedHosts.length > 0) {
        hostsChosen.set(pool.id, forcedHosts[0]);
        chosenHostIds.add(forcedHosts[0].id);
      } else {
        const specific = pool.specificCriteria || { useSpecific: false };
        const avoidMultiDate = specific.useSpecific && specific.avoidMultipleHostsOnSameDate !== undefined ? specific.avoidMultipleHostsOnSameDate : globalCriteria.avoidMultipleHostsOnSameDate;
        const avoidPrevHosts = specific.useSpecific && specific.avoidPreviousHosts !== undefined ? specific.avoidPreviousHosts : globalCriteria.avoidPreviousHosts;
        const avoidInsuffBane = specific.useSpecific && specific.avoidInsufficientBaneCapacity !== undefined ? specific.avoidInsufficientBaneCapacity : globalCriteria.avoidInsufficientBaneCapacity;
        const prioritizeNewHost = specific.useSpecific && specific.prioritizeNewHostInAgeGroup !== undefined ? specific.prioritizeNewHostInAgeGroup : globalCriteria.prioritizeNewHostInAgeGroup;

        const hostFilters = {
          avoidMultipleHostsOnSameDate: (list) => {
            if (!dateLabel || !avoidMultiDate) return list;
            const result = list.filter(t => !existingHostsOnDate.has(t.club));
            return result.length > 0 ? result : list;
          },
          avoidPreviousHosts: (list) => {
            if (!avoidPrevHosts || !previousHistory) return list;
            const result = list.filter(t => !previousHistory.some(p => p.rowName === rowName && p.club === t.club));
            return result.length > 0 ? result : list;
          },
          avoidInsufficientBaneCapacity: (list) => {
            if (!avoidInsuffBane) return list;
            const formatField = getRowFormat(row.name);
            const is3v3 = row.name.includes('3:3');
            const matrices = is3v3 ? fodaMatrices3v3 : fodaMatrices;
            const dTempl = is3v3 ? defaultTemplates3v3 : defaultTemplates;
            const tKey = (pool.templateKey && matrices[pool.templateKey]?.size === estimatedPoolSize)
              ? pool.templateKey
              : (dTempl[estimatedPoolSize] || Object.keys(matrices).find(k => matrices[k].size === estimatedPoolSize));
            const baneCount = getBaneCountFromTemplate(tKey);
            const result = list.filter(t => {
              const clubData = clubs.find(c => matchClubName(c.name, t.club));
              if (!clubData) return true;
              return parseNumber(clubData[formatField]) >= baneCount;
            });
            return result.length > 0 ? result : list;
          },
          prioritizeNewHostInAgeGroup: (list) => {
            if (!prioritizeNewHost) return list;
            const ageGroupMatch = row.name.match(/^(U\d+)/i);
            if (!ageGroupMatch || !allRowsData) return list;
            const ageGroup = ageGroupMatch[1].toUpperCase();
            const hostsInAgeGroup = new Set();
            allRowsData.forEach(r => {
              const rAge = r.name.match(/^(U\d+)/i);
              if (rAge && rAge[1].toUpperCase() === ageGroup) {
                r.teams.forEach(t => {
                  if (t.isHost && t.poolId !== null && !t.isBye) hostsInAgeGroup.add(t.club);
                });
              }
            });
            hostsChosen.forEach(hostTeam => {
              hostsInAgeGroup.add(hostTeam.club);
            });
            const result = list.filter(t => !hostsInAgeGroup.has(t.club));
            return result.length > 0 ? result : list;
          }
        };

        let filteredHosts = [...potentialHosts];
        hostCriteriaPriority.forEach(key => {
          if (hostFilters[key]) {
            filteredHosts = hostFilters[key](filteredHosts);
          }
        });

        if (filteredHosts.length > 0) {
          hostsChosen.set(pool.id, filteredHosts[0]);
          chosenHostIds.add(filteredHosts[0].id);
        }
      }
    });

    // Place chosen hosts in their pools
    hostsChosen.forEach((hostTeam, poolId) => {
      const idx = newTeams.findIndex(t => t.id === hostTeam.id);
      if (idx !== -1) {
        newTeams[idx] = { ...newTeams[idx], poolId, isHost: true };
        const pData = poolData.find(pd => pd.id === poolId);
        if (pData) {
          pData.teamsCount += 1;
          if (!hostTeam.isBye) pData.clubSet.add(hostTeam.club);
        }
        if (!hostTeam.isBye) existingHostsOnDate.add(hostTeam.club);
      }
    });

    // === PHASE 2: DISTRIBUTE REMAINING TEAMS (with geographic proximity to host) ===
    const anyPoolWantsGeo = row.pools.length >= 2 && row.pools.some(pool => {
      const spec = pool.specificCriteria || { useSpecific: false };
      return spec.useSpecific ? spec.preferGeographicProximity : globalCriteria.preferGeographicProximity;
    });

    const poolCentersForDistribution = {};
    if (anyPoolWantsGeo) {
      row.pools.forEach(pool => {
        const isOrg = (pool.hostMode || 'host') === 'organizer';
        if (isOrg && pool.organizerClub) {
          poolCentersForDistribution[pool.id] = getClubCoordinates(pool.organizerClub);
        } else {
          const hostTeam = hostsChosen.get(pool.id);
          if (hostTeam) {
            poolCentersForDistribution[pool.id] = getClubCoordinates(hostTeam.club);
          } else {
            const pinnedHost = teamsToKeep.find(t => t.poolId === pool.id && t.isHost && !t.isBye);
            if (pinnedHost) poolCentersForDistribution[pool.id] = getClubCoordinates(pinnedHost.club);
          }
        }
      });
    }

    const unassignedTeams = shuffled.filter(t => !chosenHostIds.has(t.id));
    const maxPerPool = Math.ceil(totalRealTeams / row.pools.length);

    unassignedTeams.forEach((team) => {
      poolData.sort((a, b) => a.teamsCount - b.teamsCount);

      const teamWishes = applicableWishes.filter(w => matchClubName(team.club, w.club));
      const wantsSamePool = teamWishes.some(w => w.ruleType === 'SAME_POOL');
      const clubsToAvoid = teamWishes.filter(w => w.ruleType === 'AVOID_CLUB').map(w => w.text.toLowerCase());

      let validPools = poolData.filter(p => {
        if (p.clubSet.has(team.club) && wantsSamePool) return true;
        if (p.avoidSameClub && p.clubSet.has(team.club)) return false;

        const hasEnemy = Array.from(p.clubSet).some(clubInPool =>
           clubsToAvoid.some(avoidText => avoidText.includes(clubInPool.toLowerCase()))
        );
        if (hasEnemy) return false;

        return true;
      });

      if (validPools.length === 0) validPools = [...poolData];

      // Enforce max pool size — prevent any pool from exceeding ceil(total/pools)
      const capacityPools = validPools.filter(p => p.teamsCount < maxPerPool);
      if (capacityPools.length > 0) validPools = capacityPools;

      // Sort: SAME_POOL priority > pool balance (primary) > geographic proximity (tiebreaker)
      if (wantsSamePool) {
        validPools.sort((a, b) => {
          const aHasClub = a.clubSet.has(team.club) ? 0 : 1;
          const bHasClub = b.clubSet.has(team.club) ? 0 : 1;
          if (aHasClub !== bHasClub) return aHasClub - bHasClub;
          return a.teamsCount - b.teamsCount;
        });
      } else {
        const teamCoord = anyPoolWantsGeo ? getClubCoordinates(team.club) : null;
        validPools.sort((a, b) => {
          // Primary: pool balance — smallest pool first
          if (a.teamsCount !== b.teamsCount) return a.teamsCount - b.teamsCount;
          // Secondary: geographic proximity to pool's host (tiebreaker when pools equal size)
          if (teamCoord) {
            const centerA = poolCentersForDistribution[a.id];
            const centerB = poolCentersForDistribution[b.id];
            if (centerA && centerB) {
              return haversineDistance(teamCoord, centerA) - haversineDistance(teamCoord, centerB);
            }
          }
          return 0;
        });
      }

      const selectedPool = validPools[0];

      const teamIndex = newTeams.findIndex(t => t.id === team.id);
      newTeams[teamIndex] = { ...team, poolId: selectedPool.id, isHost: false };

      selectedPool.teamsCount += 1;
      if (!team.isBye) selectedPool.clubSet.add(team.club);
    });

    // === PHASE 3: GEOGRAPHIC PROXIMITY OPTIMIZATION ===
    if (row.pools.length >= 2) {
      const anyPoolWantsGeo = row.pools.some(pool => {
        const spec = pool.specificCriteria || { useSpecific: false };
        return spec.useSpecific ? spec.preferGeographicProximity : globalCriteria.preferGeographicProximity;
      });

      if (anyPoolWantsGeo) {
        const poolCenters = {};
        row.pools.forEach(pool => {
          const isOrg = (pool.hostMode || 'host') === 'organizer';
          if (isOrg && pool.organizerClub) {
            poolCenters[pool.id] = getClubCoordinates(pool.organizerClub);
          } else {
            const host = newTeams.find(t => t.poolId === pool.id && t.isHost);
            if (host) poolCenters[pool.id] = getClubCoordinates(host.club);
          }
        });

        const poolsWithCoords = Object.keys(poolCenters).filter(id => poolCenters[id] !== null);
        if (poolsWithCoords.length >= 2) {
          const keptIds = new Set(teamsToKeep.map(t => t.id));
          let improved = true;
          let iterations = 0;
          while (improved && iterations < 50) {
            improved = false;
            iterations++;
            for (let i = 0; i < newTeams.length; i++) {
              const tA = newTeams[i];
              if (!tA.poolId || tA.isHost || tA.isBye || tA.isPinned || keptIds.has(tA.id)) continue;
              const poolA = row.pools.find(p => p.id === tA.poolId);
              const specA = poolA?.specificCriteria || { useSpecific: false };
              const geoA = specA.useSpecific ? specA.preferGeographicProximity : globalCriteria.preferGeographicProximity;
              const centerA = poolCenters[tA.poolId];
              const coordA = getClubCoordinates(tA.club);
              if (!centerA || !coordA) continue;
              for (let j = i + 1; j < newTeams.length; j++) {
                const tB = newTeams[j];
                if (!tB.poolId || tB.isHost || tB.isBye || tB.isPinned || keptIds.has(tB.id)) continue;
                if (tA.poolId === tB.poolId) continue;
                const poolB = row.pools.find(p => p.id === tB.poolId);
                const specB = poolB?.specificCriteria || { useSpecific: false };
                const geoB = specB.useSpecific ? specB.preferGeographicProximity : globalCriteria.preferGeographicProximity;
                if (!geoA && !geoB) continue;
                const centerB = poolCenters[tB.poolId];
                const coordB = getClubCoordinates(tB.club);
                if (!centerB || !coordB) continue;
                const currentCost = haversineDistance(coordA, centerA) + haversineDistance(coordB, centerB);
                const swappedCost = haversineDistance(coordA, centerB) + haversineDistance(coordB, centerA);
                if (swappedCost < currentCost - 0.5) {
                  const avoidA = specA.useSpecific ? specA.avoidSameClub : globalCriteria.avoidSameClub;
                  const avoidB = specB.useSpecific ? specB.avoidSameClub : globalCriteria.avoidSameClub;
                  const poolAOtherClubs = newTeams.filter(t => t.poolId === tA.poolId && t.id !== tA.id && !t.isBye).map(t => t.club);
                  const poolBOtherClubs = newTeams.filter(t => t.poolId === tB.poolId && t.id !== tB.id && !t.isBye).map(t => t.club);
                  const violatesA = avoidA && poolAOtherClubs.includes(tB.club);
                  const violatesB = avoidB && poolBOtherClubs.includes(tA.club);
                  if (!violatesA && !violatesB) {
                    const tempPoolId = newTeams[i].poolId;
                    newTeams[i] = { ...newTeams[i], poolId: newTeams[j].poolId };
                    newTeams[j] = { ...newTeams[j], poolId: tempPoolId };
                    improved = true;
                  }
                }
              }
            }
          }
        }
      }
    }

    // === PHASE 4: AUTO-FILL SMALL POOLS WITH BYES ===
    newTeams = newTeams.filter(t => !(t.isBye && t.name === 'Oversidder'));
    row.pools.forEach(pool => {
      const realTeamsInPool = newTeams.filter(t => t.poolId === pool.id && !t.isBye).length;
      const minPoolSize = row.name.includes('3:3') ? 3 : 4;
      if (realTeamsInPool > 0 && realTeamsInPool < minPoolSize) {
        const byesToAdd = minPoolSize - realTeamsInPool;
        for (let b = 0; b < byesToAdd; b++) {
          newTeams.push({
            id: `bye_${Date.now()}_${Math.random()}_${pool.id}_${b}`,
            name: 'Oversidder',
            poolId: pool.id,
            club: `Oversidder_System_${Date.now()}_${b}`,
            isHost: false,
            isBye: true,
            isPinned: false,
            fodaKey: null
          });
        }
      }
    });

    const is3v3 = row.name.includes('3:3');
    return recalculateAllRowKeys({ ...row, teams: newTeams }, globalCriteria, is3v3 ? defaultTemplates3v3 : defaultTemplates, is3v3 ? customHostKeys3v3 : customHostKeys, is3v3 ? defaultTemplates : defaultTemplates3v3, is3v3 ? customHostKeys : customHostKeys3v3);
  };

  // Ren beregningsfunktion — returnerer nyt data-array uden at sætte state
  const computeRandomizedData = (currentData, mode, scope) => {
    let newData = [...currentData];
    for (let i = 0; i < newData.length; i++) {
      if (scope === 'active' && newData[i].id !== activeRowId) continue;
      newData[i] = applyRandomizationToRow(newData[i], mode, criteria, newData, previousTournaments);
    }
    return newData;
  };

  // Auto-retry: Kører op til 3 forsøg og vælger det bedste resultat
  const executeRandomizeWithRetry = (mode, scope) => {
    setData(prevData => {
      // Auto-create pools for rows that don't have any
      let dataWithPools = [...prevData];
      for (let i = 0; i < dataWithPools.length; i++) {
        if (scope === 'active' && dataWithPools[i].id !== activeRowId) continue;
        let row = dataWithPools[i];
        if (row.pools.length === 0 && row.teams.length > 0) {
          const targetCount = getOptimalPoolConfig(row.teams.filter(t => !t.isBye).length).poolCount;
          if (targetCount > 0) {
            row = { ...row };
            row.pools = Array.from({ length: targetCount }).map((_, idx) => ({
              id: `p${Date.now()}_${row.id}_${idx}`,
              name: `Pulje ${idx + 1}`,
              specificCriteria: { ...defaultSpecificCriteria },
              hostMode: 'host', organizerClub: null, formatOverride: null
            }));
            row.columnOrder = ['unassigned', ...row.pools.map(p => p.id)];
            dataWithPools[i] = row;
          }
        }
      }

      let bestData = null;
      let bestConflictCount = Infinity;

      for (let attempt = 0; attempt < 3; attempt++) {
        const candidateData = computeRandomizedData(dataWithPools, mode, scope);
        const rowsToCheck = scope === 'active'
          ? candidateData.filter(r => r.id === activeRowId && r.teams.length > 0 && r.pools.length > 0)
          : candidateData.filter(r => r.teams.length > 0 && r.pools.length > 0);
        const conflicts = collectAllConflicts(rowsToCheck, candidateData);
        const unresolvedCount = conflicts.filter(c => !c.resolved).length;

        if (unresolvedCount === 0) {
          bestData = candidateData;
          break;
        }
        if (unresolvedCount < bestConflictCount) {
          bestData = candidateData;
          bestConflictCount = unresolvedCount;
        }
      }

      return bestData || prevData;
    });
    setValidationModal({ isOpen: true, scope });
  };

  const handleCreatePoolsAndRandomize = () => {
    const { count, scope } = createPoolsPrompt;
    setData(prevData => {
      // Først: opret puljer
      let dataWithPools = [...prevData];
      for (let i = 0; i < dataWithPools.length; i++) {
        if (scope === 'active' && dataWithPools[i].id !== activeRowId) continue;
        let currentRow = { ...dataWithPools[i] };
        if (currentRow.pools.length === 0 && currentRow.teams.length > 0) {
          const targetCount = (scope === 'active' || currentRow.id === activeRowId) ? count : getOptimalPoolConfig(currentRow.teams.length).poolCount;
          if (targetCount > 0) {
            currentRow.pools = Array.from({ length: targetCount }).map((_, idx) => ({
              id: `p${Date.now()}_${currentRow.id}_${idx}`,
              name: `Pulje ${idx + 1}`,
              specificCriteria: { ...defaultSpecificCriteria },
              hostMode: 'host', organizerClub: null, formatOverride: null
            }));
            currentRow.columnOrder = ['unassigned', ...currentRow.pools.map(p => p.id)];
          }
        }
        dataWithPools[i] = currentRow;
      }

      // Derefter: retry-randomisering (op til 3 forsøg)
      let bestData = null;
      let bestConflictCount = Infinity;
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidateData = computeRandomizedData(dataWithPools, 'all', scope);
        const rowsToCheck = scope === 'active'
          ? candidateData.filter(r => r.id === activeRowId && r.teams.length > 0 && r.pools.length > 0)
          : candidateData.filter(r => r.teams.length > 0 && r.pools.length > 0);
        const conflicts = collectAllConflicts(rowsToCheck, candidateData);
        const unresolvedCount = conflicts.filter(c => !c.resolved).length;
        if (unresolvedCount === 0) { bestData = candidateData; break; }
        if (unresolvedCount < bestConflictCount) { bestData = candidateData; bestConflictCount = unresolvedCount; }
      }

      return bestData || dataWithPools;
    });
    setCreatePoolsPrompt({ isOpen: false, count: 1, scope: null });
    setValidationModal({ isOpen: true, scope });
  };

  const handleRandomizeClick = (scope) => {
    const rowsToCheck = scope === 'active' ? [activeRow] : data;
    const hasPools = rowsToCheck.some(r => r.pools.length > 0);
    const hasAssigned = rowsToCheck.some(r => r.teams.some(t => t.poolId !== null));

    if (!hasPools) {
      const suggestedCount = getOptimalPoolConfig(activeRow.teams.filter(t => !t.isBye).length).poolCount;
      setCreatePoolsPrompt({ isOpen: true, count: Math.max(1, suggestedCount), scope });
      return;
    }

    if (hasAssigned) {
      setReshufflePrompt({ isOpen: true, scope });
    } else {
      executeRandomizeWithRetry('all', scope);
    }
  };

  const handleGuideDragStart = (e) => {
    e.preventDefault();
    const startX = e.clientX - guideDrag.x;
    const startY = e.clientY - guideDrag.y;
    const onMove = (ev) => setGuideDrag({ x: ev.clientX - startX, y: ev.clientY - startY });
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);
    const container = document.getElementById('pdf-print-view');
    try {
      // Make the print view visible off-screen
      container.classList.remove('hidden');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidthMM = pdf.internal.pageSize.getWidth();   // 297
      const pageHeightMM = pdf.internal.pageSize.getHeight();  // 210

      // Capture each page individually — no canvas slicing needed
      const totalPages = pdfPages.length;
      for (let i = 0; i < totalPages; i++) {
        const pageEl = document.getElementById(`pdf-page-${i}`);
        if (!pageEl) continue;

        const canvas = await html2canvas(pageEl, {
          scale: 1.5,
          useCORS: true,
          logging: false,
          allowTaint: true,
          width: 1122,
          height: 793,
          windowWidth: 1122
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMM, pageHeightMM);
      }

      pdf.save('Stævneplan.pdf');

    } catch (err) {
      console.error("Fejl ved PDF generering:", err);
      setInfoModal({
        isOpen: true,
        title: 'PDF Fejl',
        message: `Kunne ikke generere PDF: ${err.message || 'Ukendt fejl'}. Prøv at reducere antallet af puljer eller genindlæs siden.`
      });
    } finally {
      if (container) {
        container.classList.add('hidden');
        container.style.position = '';
        container.style.left = '';
        container.style.top = '';
      }
      setIsGeneratingPDF(false);
    }
  };

  // Fælles funktion: konvertér parsede rækker til fulde row-objekter med puljer
  const buildImportedRows = (parsedRows) => {
    return parsedRows.map(row => {
      const is3v3 = row.name.includes('3:3');
      const config = getOptimalPoolConfig(row.teams.length);
      const pools = Array.from({ length: config.poolCount }).map((_, idx) => ({
        id: `import_p${idx+1}_${Date.now()}_${row.id}`,
        name: `Pulje ${idx + 1}`,
        specificCriteria: { ...defaultSpecificCriteria },
        hostMode: 'host', organizerClub: null, formatOverride: null
      }));
      const templates = is3v3 ? defaultTemplates3v3 : defaultTemplates;
      const hostKeys = is3v3 ? customHostKeys3v3 : customHostKeys;
      const altTemplates = is3v3 ? defaultTemplates : defaultTemplates3v3;
      const altHostKeys = is3v3 ? customHostKeys : customHostKeys3v3;
      return recalculateAllRowKeys(
        { ...row, pools, hasWarning: config.hasWarning, columnOrder: ['unassigned', ...pools.map(p => p.id)] },
        criteria, templates, hostKeys, altTemplates, altHostKeys
      );
    });
  };

  // Parse HTML-tabel format (fod@ eksport: .xls der egentlig er HTML)
  const parseHtmlRowImport = (html) => {
    const parsedRows = [];
    // Find alle sektioner med ItemHeadline (rækkenavn) og tilhørende hold-tabel
    const sectionRegex = /class='ItemHeadline'.*?<td[^>]*width='40%'[^>]*>(.*?)<\/td>.*?<table[^>]*bordercolor[^>]*>(.*?)<\/table>/gs;
    const teamRegex = /<td[^>]*width='10%'[^>]*>(.*?)<\/td>\s*<td[^>]*width='90%'[^>]*>(.*?)<\/td>/g;
    let sMatch;
    while ((sMatch = sectionRegex.exec(html)) !== null) {
      const rowName = sMatch[1].replace(/&amp;/g, '&').trim();
      if (!rowName) continue;
      const teamHtml = sMatch[2];
      const teams = [];
      let tMatch;
      let tIdx = 0;
      while ((tMatch = teamRegex.exec(teamHtml)) !== null) {
        const rawName = tMatch[2].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
        if (!rawName) continue;
        const clubMatch = rawName.match(/^(.*?)(?:\s*\(\d+\))*$/);
        const club = normalizeClubName(clubMatch ? clubMatch[1].trim() : rawName);
        teams.push({
          id: `import_t_${Date.now()}_${parsedRows.length}_${tIdx++}`,
          name: rawName, poolId: null, club: club,
          isHost: false, isBye: false, isPinned: false, fodaKey: null
        });
      }
      if (teams.length > 0) {
        parsedRows.push({
          id: `import_r_${Date.now()}_${parsedRows.length}`,
          name: rowName, teams: teams
        });
      }
    }
    return parsedRows;
  };

  // Parse Excel (.xlsx / binær .xls) via XLSX-bibliotek
  const parseExcelRowImport = (arrayBuffer) => {
    const wb = XLSX.read(arrayBuffer, { type: 'array', raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (rows.length < 5) return [];

    const parsedRows = [];
    let i = 0;
    while (i < rows.length) {
      const cell0 = String(rows[i][0] || '').trim();
      if (cell0 === 'Række/Pulje oversigt') {
        const headerIdx = i + 3;
        if (headerIdx >= rows.length) break;
        const rowName = String(rows[headerIdx][2] || '').trim();
        if (!rowName) { i++; continue; }
        const teams = [];
        let j = headerIdx + 1;
        while (j < rows.length) {
          const jCell0 = String(rows[j][0] || '').trim();
          const jCell1 = String(rows[j][1] || '').trim();
          if (jCell0.startsWith('Der er tilmeldt')) break;
          if (jCell0 === 'Række/Pulje oversigt') break;
          if (!jCell1) { j++; continue; }
          const clubMatch = jCell1.match(/^(.*?)(?:\s*\(\d+\))*$/);
          const club = normalizeClubName(clubMatch ? clubMatch[1].trim() : jCell1);
          teams.push({
            id: `import_t_${Date.now()}_${j}`,
            name: jCell1, poolId: null, club: club,
            isHost: false, isBye: false, isPinned: false, fodaKey: null
          });
          j++;
        }
        if (teams.length > 0) {
          parsedRows.push({
            id: `import_r_${Date.now()}_${parsedRows.length}`,
            name: rowName, teams: teams
          });
        }
        i = j + 1;
      } else { i++; }
    }
    return parsedRows;
  };

  // Parse CSV/TXT format
  const parseCsvRowImport = (text) => {
    const lines = text.split(/\r?\n/);
    if (lines.length < 4) return [];
    const firstLine = lines[0] || '';
    const separator = (firstLine.split(';').length - 1) >= (firstLine.split(',').length - 1) ? ';' : ',';
    const parseCSVLine = (line) => {
      const result = []; let current = ''; let inQuotes = false;
      for (let k = 0; k < line.length; k++) {
        const char = line[k];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === separator && !inQuotes) { result.push(current.trim()); current = ''; }
        else current += char;
      }
      result.push(current.trim());
      return result;
    };
    const headers = parseCSVLine(lines[0]);
    const tempRows = headers.map((header, colIndex) => {
      if (!header) return null;
      return { id: `import_r_${Date.now()}_${colIndex}`, name: header, teams: [] };
    });
    for (let li = 3; li < lines.length; li++) {
      const cells = parseCSVLine(lines[li]);
      cells.forEach((cellText, colIndex) => {
        if (cellText && tempRows[colIndex]) {
          const clubMatch = cellText.match(/^(.*?)(?:\s*\(\d+\)|\s+\d+|\s+\*\*)*$/);
          const club = normalizeClubName(clubMatch ? clubMatch[1].trim() : cellText);
          tempRows[colIndex].teams.push({
            id: `import_t_${Date.now()}_${li}_${colIndex}`,
            name: cellText, poolId: null, club: club, isHost: false, isBye: false, isPinned: false, fodaKey: null
          });
        }
      });
    }
    return tempRows.filter(r => r && r.teams.length > 0);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isExcelExt = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    if (isExcelExt) {
      // Læs som ArrayBuffer — kan være ægte Excel ELLER HTML-tabel med .xls-extension
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const arrayBuffer = event.target.result;
          // Tjek om indholdet er HTML (fod@ eksporterer HTML med .xls-extension)
          const firstBytes = new Uint8Array(arrayBuffer.slice(0, 20));
          const header = String.fromCharCode(...firstBytes);
          const isHtml = header.trimStart().startsWith('<!DOC') || header.trimStart().startsWith('<HTML') || header.trimStart().startsWith('<html');

          let parsedRows;
          if (isHtml) {
            // Dekod som ISO-8859-1 (latin1) og parse HTML-tabeller
            const decoder = new TextDecoder('iso-8859-1');
            const html = decoder.decode(arrayBuffer);
            parsedRows = parseHtmlRowImport(html);
          } else {
            // Ægte Excel-fil — brug XLSX-bibliotek
            parsedRows = parseExcelRowImport(arrayBuffer);
          }

          const finalRows = buildImportedRows(parsedRows);
          if (finalRows.length > 0) {
            setData(finalRows);
            setActiveRowId(finalRows[0].id);
            setActiveTab('rækker');
          } else {
            setInfoModal({ isOpen: true, title: 'Tom fil', message: 'Kunne ikke finde nogle hold i filen. Tjek at formatet er korrekt (Række/Pulje oversigt).' });
          }
        } catch (err) {
          console.error('Import parse error:', err);
          setInfoModal({ isOpen: true, title: 'Fejl ved læsning', message: `Kunne ikke læse filen: ${err.message}` });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // --- CSV/TXT-PARSING ---
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const parsedRows = parseCsvRowImport(text);
        const finalRows = buildImportedRows(parsedRows);
        if (finalRows.length > 0) {
          setData(finalRows);
          setActiveRowId(finalRows[0].id);
          setActiveTab('rækker');
        } else {
          setInfoModal({ isOpen: true, title: 'Tom fil', message: 'Kunne ikke finde nogle hold i filen. Tjek at formatet er korrekt.' });
        }
      };
      reader.readAsText(file, 'windows-1252');
    }
    e.target.value = '';
  };

  // Udledt data til de nye ønskefiltre
  const { uniqueCategories, uniqueArgange, uniqueKoen, uniqueNiveauer } = useMemo(() => ({
    uniqueCategories: [...new Set(wishes.map(item => item.kategori))].filter(Boolean),
    uniqueArgange: [...new Set(wishes.map(item => item.age).filter(a => a && a !== 'Generelt'))].sort(),
    uniqueKoen: [...new Set(wishes.map(item => item.koen))].filter(Boolean).sort(),
    uniqueNiveauer: [...new Set(wishes.flatMap(item => item.niveauer))].filter(n => n && n !== 'Ikke angivet').sort()
  }), [wishes]);

  // NYT: Find alle dubletter ud fra en unik nøgle
  const duplicateWishesIds = useMemo(() => {
    const seen = new Map();
    const duplicates = new Set();
    wishes.forEach(w => {
      // Vi ignorerer kontaktperson, men en dublet skal være ens på:
      // klub, årgang, køn, kategori (dato), niveau og selve teksten
      const niveauerStr = w.niveauer ? [...w.niveauer].sort().join('-') : '';
      const key = `${w.club}_${w.age}_${w.koen}_${w.kategori}_${niveauerStr}_${(w.text||'').trim().toLowerCase()}`;
      
      if (seen.has(key)) {
        duplicates.add(w.id);
        duplicates.add(seen.get(key)); // Tilføj også den første vi så
      } else {
        seen.set(key, w.id);
      }
    });
    return duplicates;
  }, [wishes]);

  const filteredWishes = useMemo(() => {
    return wishes.filter(item => {
      if (showDuplicatesOnly && !duplicateWishesIds.has(item.id)) return false;

      const matchSearch = (item.club || '').toLowerCase().includes(wishesSearchTerm.toLowerCase()) || 
                          (item.text || '').toLowerCase().includes(wishesSearchTerm.toLowerCase());
      const matchCategory = wishesFilterCategory === 'ALL_FILTER' || item.kategori === wishesFilterCategory;
      const matchArgang = wishesFilterArgang === 'ALL_FILTER' || item.age === wishesFilterArgang;
      const matchKoen = wishesFilterKoen === 'ALL_FILTER' || item.koen === wishesFilterKoen;
      const matchNiveau = wishesFilterNiveau === 'ALL_FILTER' || (item.niveauer && item.niveauer.includes(wishesFilterNiveau));
      const matchRegel = wishesFilterRegel === 'ALL_FILTER' || item.ruleType === wishesFilterRegel;
      
      return matchSearch && matchCategory && matchArgang && matchKoen && matchNiveau && matchRegel;
    });
  }, [wishes, wishesSearchTerm, wishesFilterCategory, wishesFilterArgang, wishesFilterKoen, wishesFilterNiveau, wishesFilterRegel, showDuplicatesOnly, duplicateWishesIds]);

  // NYT: Sorteringslogik der kører efter filtreringen
  const sortedWishes = useMemo(() => {
    let sortableItems = [...filteredWishes];
    if (wishesSortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[wishesSortConfig.key];
        let bVal = b[wishesSortConfig.key];
        
        // Håndter booleans (isActive)
        if (typeof aVal === 'boolean') aVal = aVal ? 1 : 0;
        if (typeof bVal === 'boolean') bVal = bVal ? 1 : 0;

        // Håndter null/undefined
        if (aVal === null || aVal === undefined) aVal = '';
        if (bVal === null || bVal === undefined) bVal = '';
        
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();

        if (aVal < bVal) return wishesSortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return wishesSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredWishes, wishesSortConfig]);

  // Gruppér ønsker efter kategori/dato for visning med bjælker
  const groupedWishes = useMemo(() => {
    const groups = [];
    const groupMap = new Map();
    sortedWishes.forEach(wish => {
      const key = wish.kategori || 'Generelle ønsker';
      if (!groupMap.has(key)) {
        const group = { kategori: key, wishes: [] };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).wishes.push(wish);
    });
    // Sorter ønsker inden for hver gruppe efter prioritet
    groups.forEach(g => {
      g.wishes.sort((a, b) => {
        if (a.priority === 0 && b.priority === 0) return 0;
        if (a.priority === 0) return 1;
        if (b.priority === 0) return -1;
        return a.priority - b.priority;
      });
    });
    return groups;
  }, [sortedWishes]);

  // Hjælpefunktion: sikrer alle ønsker i en kategori har løbende prioriteter
  const ensureWishPriorities = (allWishes, kategori) => {
    const inCat = allWishes.filter(w => (w.kategori || 'Generelle ønsker') === kategori);
    const needsInit = inCat.some(w => !w.priority || w.priority === 0);
    if (!needsInit) return allWishes;
    const sorted = [...inCat].sort((a, b) => (a.priority || 9999) - (b.priority || 9999));
    const updates = new Map();
    sorted.forEach((w, i) => updates.set(w.id, i + 1));
    return allWishes.map(w => updates.has(w.id) ? { ...w, priority: updates.get(w.id) } : w);
  };

  // Flyt et ønske op eller ned inden for sin kategori
  const moveWishInCategory = (wishId, direction) => {
    setWishes(prev => {
      const wish = prev.find(w => w.id === wishId);
      if (!wish) return prev;
      const kategori = wish.kategori || 'Generelle ønsker';
      const initialized = ensureWishPriorities(prev, kategori);
      const inCat = initialized.filter(w => (w.kategori || 'Generelle ønsker') === kategori)
        .sort((a, b) => a.priority - b.priority);
      const idx = inCat.findIndex(w => w.id === wishId);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= inCat.length) return initialized;
      const targetId = inCat[swapIdx].id;
      const myPri = inCat[idx].priority;
      const theirPri = inCat[swapIdx].priority;
      return initialized.map(w => {
        if (w.id === wishId) return { ...w, priority: theirPri };
        if (w.id === targetId) return { ...w, priority: myPri };
        return w;
      });
    });
  };

  // Sæt prioritetsnummer direkte på et ønske (og omfordel de andre)
  const setWishPriority = (wishId, newPriority) => {
    setWishes(prev => {
      const wish = prev.find(w => w.id === wishId);
      if (!wish) return prev;
      const kategori = wish.kategori || 'Generelle ønsker';
      const initialized = ensureWishPriorities(prev, kategori);
      const inCat = initialized.filter(w => (w.kategori || 'Generelle ønsker') === kategori)
        .sort((a, b) => a.priority - b.priority);
      const clamped = Math.max(1, Math.min(newPriority, inCat.length));
      // Fjern ønsket fra listen og indsæt på ny position
      const without = inCat.filter(w => w.id !== wishId);
      without.splice(clamped - 1, 0, inCat.find(w => w.id === wishId));
      const updates = new Map();
      without.forEach((w, i) => updates.set(w.id, i + 1));
      return initialized.map(w => updates.has(w.id) ? { ...w, priority: updates.get(w.id) } : w);
    });
  };

  // Drag-and-drop: flyt et ønske til en ny position inden for samme kategori
  const handleWishDrop = (draggedId, targetId) => {
    if (draggedId === targetId) return;
    setWishes(prev => {
      const dragWish = prev.find(w => w.id === draggedId);
      const targetWish = prev.find(w => w.id === targetId);
      if (!dragWish || !targetWish) return prev;
      const dragKat = dragWish.kategori || 'Generelle ønsker';
      const targetKat = targetWish.kategori || 'Generelle ønsker';
      if (dragKat !== targetKat) return prev; // Kun inden for samme spilledag
      const initialized = ensureWishPriorities(prev, dragKat);
      const inCat = initialized.filter(w => (w.kategori || 'Generelle ønsker') === dragKat)
        .sort((a, b) => a.priority - b.priority);
      const without = inCat.filter(w => w.id !== draggedId);
      const targetIdx = without.findIndex(w => w.id === targetId);
      without.splice(targetIdx, 0, inCat.find(w => w.id === draggedId));
      const updates = new Map();
      without.forEach((w, i) => updates.set(w.id, i + 1));
      return initialized.map(w => updates.has(w.id) ? { ...w, priority: updates.get(w.id) } : w);
    });
    setDragWishId(null);
    setDragOverWishId(null);
  };

  // Funktion til at skifte sorteringsretning
  const handleWishesSort = (key) => {
    let direction = 'asc';
    if (wishesSortConfig.key === key && wishesSortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setWishesSortConfig({ key, direction });
  };

  // SortIcon er nu defineret udenfor App-komponenten for at undgå re-mount ved hvert render

  const renderKriterierView = () => (
    <div className="flex-1 overflow-auto p-8 bg-gray-50 flex flex-col items-center">
      <div className="max-w-3xl w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-8 h-8 text-green-600" />
          <h2 className="text-2xl font-bold text-gray-800">Generelle Kriterier</h2>
        </div>
        <p className="text-gray-600 mb-8 border-b border-gray-100 pb-6">
          Vælg de regler som systemet skal forsøge at overholde, når du beder den om at generere puljer automatisk. Bemærk at "Aktive Ønsker" (f.eks. at spille i samme pulje eller tvinge et værtskab) kan overtrumfe disse generelle regler.
        </p>

        <div className="space-y-4">
          <label className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${criteria.avoidSameClub ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}>
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${criteria.avoidSameClub ? 'bg-green-600' : 'bg-gray-200'}`}>
              {criteria.avoidSameClub && <Check className="w-4 h-4 text-white" />}
            </div>
            <div>
              <div className="font-bold text-gray-800 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-500" /> Ingen hold fra samme klub i samme pulje</div>
              <div className="text-sm text-gray-500 mt-1">
                Programmet vil altid prøve at splitte hold fra samme klub ud i forskellige puljer.
              </div>
            </div>
            <input type="checkbox" className="hidden" checked={criteria.avoidSameClub} onChange={(e) => setCriteria({...criteria, avoidSameClub: e.target.checked})} />
          </label>

          <label className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${criteria.autoAssignHost ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}>
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${criteria.autoAssignHost ? 'bg-green-600' : 'bg-gray-200'}`}>
              {criteria.autoAssignHost && <Check className="w-4 h-4 text-white" />}
            </div>
            <div>
              <div className="font-bold text-gray-800 flex items-center gap-2"><UserCheck className="w-5 h-5 text-purple-500" /> Udvælg automatisk Værtsklub</div>
              <div className="text-sm text-gray-500 mt-1">
                Når programmet har fordelt holdene i en pulje, vil den automatisk udvælge et hold og placere dem som vært.
              </div>
            </div>
            <input type="checkbox" className="hidden" checked={criteria.autoAssignHost} onChange={(e) => setCriteria({...criteria, autoAssignHost: e.target.checked})} />
          </label>

          <label className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${criteria.hostGetsMostMatches ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}>
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${criteria.hostGetsMostMatches ? 'bg-green-600' : 'bg-gray-200'}`}>
              {criteria.hostGetsMostMatches && <Check className="w-4 h-4 text-white" />}
            </div>
            <div>
              <div className="font-bold text-gray-800 flex items-center gap-2"><Key className="w-5 h-5 text-amber-500" /> Værtsklubben skal have nøglen med flere kampe</div>
              <div className="text-sm text-gray-500 mt-1">
                Sikrer automatisk at værtsklubben får den Foda-nøgle i puljen, der udløser flest kampe.
              </div>
            </div>
            <input type="checkbox" className="hidden" checked={criteria.hostGetsMostMatches} onChange={(e) => {
              const newCrit = {...criteria, hostGetsMostMatches: e.target.checked};
              setCriteria(newCrit);
              setData(prevData => prevData.map(row => {
                const is3v3 = row.name.includes('3:3');
                return recalculateAllRowKeys(row, newCrit, is3v3 ? defaultTemplates3v3 : defaultTemplates, is3v3 ? customHostKeys3v3 : customHostKeys, is3v3 ? defaultTemplates : defaultTemplates3v3, is3v3 ? customHostKeys : customHostKeys3v3);
              }));
            }} />
          </label>

          <label className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${criteria.checkBaneCapacity ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}>
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${criteria.checkBaneCapacity ? 'bg-green-600' : 'bg-gray-200'}`}>
              {criteria.checkBaneCapacity && <Check className="w-4 h-4 text-white" />}
            </div>
            <div>
              <div className="font-bold text-gray-800 flex items-center gap-2"><Grid className="w-5 h-5 text-orange-500" /> Tjek banekapacitet hos værtsklubber</div>
              <div className="text-sm text-gray-500 mt-1">
                Kontrollerer at det samlede antal baner, som kræves af alle puljer en klub er vært for på samme dato, ikke overstiger klubbens registrerede banekapacitet i Baner-oversigten.
              </div>
            </div>
            <input type="checkbox" className="hidden" checked={criteria.checkBaneCapacity} onChange={(e) => setCriteria({...criteria, checkBaneCapacity: e.target.checked})} />
          </label>

          <label className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${criteria.preferGeographicProximity ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}>
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${criteria.preferGeographicProximity ? 'bg-green-600' : 'bg-gray-200'}`}>
              {criteria.preferGeographicProximity && <Check className="w-4 h-4 text-white" />}
            </div>
            <div>
              <div className="font-bold text-gray-800 flex items-center gap-2"><MapPin className="w-5 h-5 text-green-500" /> Geografisk nærhed i puljer</div>
              <div className="text-sm text-gray-500 mt-1">
                Når der er 2+ puljer i en række, prioriteres det at hold placeres tæt på hinanden geografisk — nær værtsklubben. Baseret på fynske klubbers lokationer.
              </div>
            </div>
            <input type="checkbox" className="hidden" checked={criteria.preferGeographicProximity} onChange={(e) => setCriteria({...criteria, preferGeographicProximity: e.target.checked})} />
          </label>
        </div>
      </div>

      {/* Sektion 2: Prioriterede Værtsklub-kriterier */}
      <div className="max-w-3xl w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 mt-6">
        <div className="flex items-center gap-3 mb-6">
          <ArrowUpDown className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">Prioriterede Værtsklub-kriterier</h2>
        </div>
        <p className="text-gray-600 mb-6 border-b border-gray-100 pb-6">
          Disse 4 kriterier filtrerer hvem der kan vælges som værtsklub. De kan modstride hinanden — rækkefølgen bestemmer hvem der "vinder" ved konflikt. Nr. 1 har højest prioritet. Brug pilene til at ændre rækkefølge.
        </p>

        <div className="space-y-3">
          {hostCriteriaPriority.map((key, idx) => {
            const meta = {
              avoidMultipleHostsOnSameDate: { icon: Calendar, color: 'text-rose-500', bgActive: 'border-rose-400 bg-rose-50', title: 'En klub kun vært én gang pr. spilledato', desc: 'Undgår at gøre den samme klub til vært for flere puljer på samme dato.' },
              avoidPreviousHosts: { icon: History, color: 'text-teal-500', bgActive: 'border-teal-400 bg-teal-50', title: 'Undgå tidligere værtsklubber', desc: 'Fravælger klubber der står på listen over tidligere stævner for samme række.' },
              avoidInsufficientBaneCapacity: { icon: Shield, color: 'text-red-500', bgActive: 'border-red-400 bg-red-50', title: 'Undgå vært uden nok banekapacitet', desc: 'Fravælger klubber der har færre baner end skabelonen kræver.' },
              prioritizeNewHostInAgeGroup: { icon: Star, color: 'text-yellow-500', bgActive: 'border-yellow-400 bg-yellow-50', title: 'Prioriter ny vært i årgangen', desc: 'Foretrækker klubber der ikke allerede er vært i en anden pulje i samme årgang.' }
            }[key];
            if (!meta) return null;
            const Icon = meta.icon;
            // avoidPreviousHosts bruger !== false for bagudkompatibilitet med gemte projekter der mangler feltet
            const isEnabled = key === 'avoidPreviousHosts' ? criteria[key] !== false : !!criteria[key];

            return (
              <div key={key} className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${isEnabled ? meta.bgActive : 'border-gray-200 bg-gray-50 opacity-60'}`}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <button onClick={() => { const n = [...hostCriteriaPriority]; if (idx > 0) { [n[idx], n[idx-1]] = [n[idx-1], n[idx]]; setHostCriteriaPriority(n); } }} disabled={idx === 0} className={`p-0.5 rounded ${idx === 0 ? 'text-gray-300' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-100'}`}>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">{idx + 1}</div>
                  <button onClick={() => { const n = [...hostCriteriaPriority]; if (idx < n.length - 1) { [n[idx], n[idx+1]] = [n[idx+1], n[idx]]; setHostCriteriaPriority(n); } }} disabled={idx === hostCriteriaPriority.length - 1} className={`p-0.5 rounded ${idx === hostCriteriaPriority.length - 1 ? 'text-gray-300' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-100'}`}>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                <label className="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
                  <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${isEnabled ? 'bg-green-600' : 'bg-gray-300'}`}>
                    {isEnabled && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <Icon className={`w-5 h-5 flex-shrink-0 ${meta.color}`} />
                  <div className="min-w-0">
                    <div className="font-bold text-gray-800 text-sm">{meta.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{meta.desc}</div>
                  </div>
                  <input type="checkbox" className="hidden" checked={isEnabled} onChange={(e) => setCriteria({...criteria, [key]: e.target.checked})} />
                </label>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sektion 3: Standard starttidspunkt */}
      <div className="max-w-3xl w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 mt-6">
        <div className="flex items-center gap-3 mb-6">
          <Clock className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">Standard starttidspunkt</h2>
        </div>
        <p className="text-gray-600 mb-6 border-b border-gray-100 pb-6">
          Alle puljer starter som standard på dette tidspunkt. Kan overskrives pr. pulje i puljens indstillinger.
        </p>
        <div className="flex items-center gap-4">
          <label className="font-semibold text-gray-700">Starttidspunkt:</label>
          <input type="time" value={criteria.defaultPoolStartTime || '10:00'}
            onChange={(e) => setCriteria({...criteria, defaultPoolStartTime: e.target.value})}
            className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 font-medium" />
        </div>
      </div>
    </div>
  );

  const renderØnskerView = () => (
    <div className="flex-1 overflow-auto p-4 md:p-8 bg-gray-50 flex flex-col items-center">
      <div className="max-w-7xl w-full space-y-6">

        {/* Header & Upload */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-xl shadow-sm border border-gray-200 gap-4">
          <div className="flex items-center gap-3">
            <Wand2 className="w-8 h-8 text-pink-600" />
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-gray-800">Klubbernes Ønsker & Regler</h2>
              <p className="text-gray-500 mt-1 text-sm">Automatiske regler udvundet fra ønsker. "Aktive" regler overtrumfer generelle kriterier.</p>
            </div>
          </div>

          <label className="flex items-center gap-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2.5 rounded-lg cursor-pointer transition-colors shadow-sm font-bold text-sm">
            <Upload size={18} />
            <span>Upload ønskefil (CSV/Excel)</span>
            <input
              type="file"
              accept=".csv, .txt, .xlsx, .xls"
              className="hidden"
              ref={wishesInputRef}
              onChange={handleWishesUpload}
            />
          </label>
        </div>

        {/* Stats / Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
            <div className="bg-blue-100 p-3 rounded-lg text-blue-600">
              <List size={24} />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase">Totale Ønsker</p>
              <p className="text-2xl font-bold text-gray-800">{wishes.length}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
            <div className="bg-green-100 p-3 rounded-lg text-green-600">
              <Users size={24} />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase">Unikke Klubber</p>
              <p className="text-2xl font-bold text-gray-800">
                {new Set(wishes.map(d => d.club)).size}
              </p>
            </div>
          </div>
          <button 
            onClick={() => setWishesFilterRegel(wishesFilterRegel === 'UNKNOWN' ? 'ALL_FILTER' : 'UNKNOWN')}
            className={`p-5 rounded-xl shadow-sm border flex items-center gap-4 cursor-pointer transition-colors text-left ${wishesFilterRegel === 'UNKNOWN' ? 'bg-amber-50 border-amber-400 scale-[1.02]' : 'bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'}`}
            title={wishesFilterRegel === 'UNKNOWN' ? "Vis alle regler" : "Klik for at filtrere og kun se ukendte regler"}
          >
            <div className={`p-3 rounded-lg transition-colors ${wishesFilterRegel === 'UNKNOWN' ? 'bg-amber-200 text-amber-800' : 'bg-amber-100 text-amber-600'}`}>
              <AlertCircle size={24} />
            </div>
            <div>
              <p className={`text-[10px] sm:text-xs font-bold uppercase transition-colors ${wishesFilterRegel === 'UNKNOWN' ? 'text-amber-700' : 'text-amber-600'}`}>Kræver Tjek (Ukendt)</p>
              <p className="text-2xl font-bold text-gray-800">{wishes.filter(w => w.ruleType === 'UNKNOWN').length}</p>
            </div>
          </button>
          
          <button 
            onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)}
            className={`p-5 rounded-xl shadow-sm border flex items-center gap-4 cursor-pointer transition-colors text-left ${showDuplicatesOnly ? 'bg-purple-50 border-purple-400 scale-[1.02]' : 'bg-white border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'}`}
            title={showDuplicatesOnly ? "Vis alle ønsker" : "Klik for at filtrere og kun se dubletter"}
          >
            <div className={`p-3 rounded-lg transition-colors ${showDuplicatesOnly ? 'bg-purple-200 text-purple-800' : 'bg-purple-100 text-purple-600'}`}>
              <Copy size={24} />
            </div>
            <div>
              <p className={`text-[10px] sm:text-xs font-bold uppercase transition-colors ${showDuplicatesOnly ? 'text-purple-700' : 'text-purple-600'}`}>Ens Ønsker (Dubletter)</p>
              <p className="text-2xl font-bold text-gray-800">{duplicateWishesIds.size}</p>
            </div>
          </button>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
            <div className="bg-pink-100 p-3 rounded-lg text-pink-600">
              <Check size={24} />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase">Filtreret Visning</p>
              <p className="text-2xl font-bold text-gray-800">{filteredWishes.length}</p>
            </div>
          </div>
        </div>

        {/* Filtre */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex flex-col gap-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Søg på klub eller ønske..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none transition-all text-sm font-medium"
              value={wishesSearchTerm}
              onChange={(e) => setWishesSearchTerm(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Regel Type</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none appearance-none bg-white text-sm"
                value={wishesFilterRegel}
                onChange={(e) => setWishesFilterRegel(e.target.value)}
              >
                <option value="ALL_FILTER">Alle regler</option>
                {RULE_TYPES.map(rt => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Dato / Kategori</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none appearance-none bg-white text-sm"
                value={wishesFilterCategory}
                onChange={(e) => setWishesFilterCategory(e.target.value)}
              >
                <option value="ALL_FILTER">Alle datoer</option>
                {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Årgang</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none appearance-none bg-white text-sm"
                value={wishesFilterArgang}
                onChange={(e) => setWishesFilterArgang(e.target.value)}
              >
                <option value="ALL_FILTER">Alle årgange</option>
                {uniqueArgange.map(arg => <option key={arg} value={arg}>{arg}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Køn</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none appearance-none bg-white text-sm"
                value={wishesFilterKoen}
                onChange={(e) => setWishesFilterKoen(e.target.value)}
              >
                <option value="ALL_FILTER">Alle køn</option>
                {uniqueKoen.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Niveau</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none appearance-none bg-white text-sm"
                value={wishesFilterNiveau}
                onChange={(e) => setWishesFilterNiveau(e.target.value)}
              >
                <option value="ALL_FILTER">Alle niveauer</option>
                {uniqueNiveauer.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Datatabel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 font-semibold text-gray-600 w-14 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('priority')}>
                    Pri. <SortIcon sortConfig={wishesSortConfig} columnKey="priority" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 w-16 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('isActive')}>
                    Aktiv <SortIcon sortConfig={wishesSortConfig} columnKey="isActive" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 w-48 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('ruleType')}>
                    Maskinlæst Regel <SortIcon sortConfig={wishesSortConfig} columnKey="ruleType" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('club')}>
                    Klub <SortIcon sortConfig={wishesSortConfig} columnKey="club" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('age')}>
                    Årgang & Filter <SortIcon sortConfig={wishesSortConfig} columnKey="age" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 min-w-[250px] cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('text')}>
                    Oprindeligt Ønske <SortIcon sortConfig={wishesSortConfig} columnKey="text" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleWishesSort('contact')}>
                    Kontaktperson <SortIcon sortConfig={wishesSortConfig} columnKey="contact" />
                  </th>
                  <th className="p-4 font-semibold text-gray-600 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groupedWishes.length > 0 ? (
                  groupedWishes.map((group) => (
                    <React.Fragment key={group.kategori}>
                      <tr className="sticky top-0 z-10 cursor-pointer select-none" onClick={() => setCollapsedWishCategories(prev => {
                        const next = new Set(prev);
                        if (next.has(group.kategori)) next.delete(group.kategori);
                        else next.add(group.kategori);
                        return next;
                      })}>
                        <td colSpan="9" className={`px-4 py-2 font-bold text-xs uppercase tracking-wider border-b-2 ${
                          group.kategori === 'Generelle ønsker'
                            ? 'bg-gray-100 text-gray-600 border-gray-300'
                            : 'bg-green-50 text-green-800 border-green-300'
                        }`}>
                          <div className="flex items-center gap-2">
                            {collapsedWishCategories.has(group.kategori)
                              ? <ChevronRight className="w-3.5 h-3.5" />
                              : <ChevronDown className="w-3.5 h-3.5" />}
                            {group.kategori}
                            <span className="text-[10px] font-normal opacity-70">({group.wishes.length} ønsker)</span>
                          </div>
                        </td>
                      </tr>
                      {!collapsedWishCategories.has(group.kategori) && group.wishes.map((row, wishIdx) => (
                        <tr
                          key={row.id}
                          draggable
                          onDragStart={(e) => { setDragWishId(row.id); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragOver={(e) => { e.preventDefault(); setDragOverWishId(row.id); }}
                          onDrop={(e) => { e.preventDefault(); handleWishDrop(dragWishId, row.id); }}
                          onDragEnd={() => { setDragWishId(null); setDragOverWishId(null); }}
                          className={`hover:bg-pink-50/30 transition-colors ${!row.isActive ? 'opacity-50 grayscale bg-gray-50' : ''} ${dragOverWishId === row.id && dragWishId !== row.id ? 'border-t-2 border-t-pink-400' : ''} ${dragWishId === row.id ? 'opacity-40' : ''}`}
                        >
                           <td className="p-1 text-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 w-8">
                              <GripVertical className="w-3.5 h-3.5 mx-auto" />
                           </td>
                           <td className="p-1 text-center w-10">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-[11px] font-bold text-gray-500">{row.priority || wishIdx + 1}</span>
                           </td>
                           <td className="p-4 text-center">
                              <input type="checkbox" checked={row.isActive} onChange={() => setWishes(wishes.map(x => x.id === row.id ? {...x, isActive: !x.isActive} : x))} className="w-4 h-4 accent-pink-600 cursor-pointer" title="Deaktiver regel" />
                           </td>
                           <td className="p-3">
                             <select
                                value={row.ruleType || 'UNKNOWN'}
                                onChange={(e) => setWishes(wishes.map(x => x.id === row.id ? {...x, ruleType: e.target.value} : x))}
                                className={`w-full px-2 py-1.5 border rounded-md outline-none text-[11px] font-bold appearance-none cursor-pointer ${
                                  row.ruleType === 'UNKNOWN' ? 'bg-amber-100 border-amber-300 text-amber-800' :
                                  row.ruleType === 'FORCE_HOST' ? 'bg-green-100 border-green-300 text-green-800' :
                                  row.ruleType === 'AVOID_HOST' ? 'bg-red-100 border-red-300 text-red-800' :
                                  row.ruleType === 'OBS' ? 'bg-purple-100 border-purple-300 text-purple-800' :
                                  'bg-blue-100 border-blue-300 text-blue-800'
                                }`}
                             >
                                {RULE_TYPES.map(rt => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
                             </select>
                           </td>
                          <td className="p-4 font-bold text-gray-800">{row.club}</td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1">
                              {row.age !== 'Generelt' ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                  {row.age}
                                </span>
                              ) : (
                                <span className="text-gray-400 italic text-[10px]">Generelt</span>
                              )}

                              {row.koen !== 'Ikke angivet' && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${row.koen === 'Piger' ? 'bg-pink-100 text-pink-800 border-pink-200' : 'bg-cyan-100 text-cyan-800 border-cyan-200'}`}>
                                  {row.koen}
                                </span>
                              )}

                              {row.niveauer && row.niveauer[0] !== 'Ikke angivet' && row.niveauer.map(n => (
                                <span key={n} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                                  Niv: {n}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-gray-800 whitespace-pre-wrap">{renderContactInfo(row.text)}</div>
                          </td>
                          <td className="p-4">
                            {row.contact && <div className="text-[11px] text-gray-600 leading-relaxed font-medium bg-gray-50 p-1.5 rounded border border-gray-100">{renderContactInfo(row.contact)}</div>}
                          </td>
                           <td className="p-4 text-right">
                             <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setEditingWish({...row, niveauer: row.niveauer ? [...row.niveauer] : ['Ikke angivet']})} className="text-gray-400 hover:text-blue-500 p-1 transition-colors" title="Rediger ønske"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => setWishes(wishes.filter(x => x.id !== row.id))} className="text-gray-400 hover:text-red-500 p-1 transition-colors" title="Slet ønske"><Trash2 className="w-4 h-4" /></button>
                             </div>
                           </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9" className="p-12 text-center text-gray-400 italic">
                      Ingen ønsker matchede dine søgekriterier.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Modal til redigering af ønske */}
      {editingWish && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditingWish(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <Edit2 size={20} className="text-pink-600" />
                Rediger ønske
              </h3>
              <button onClick={() => setEditingWish(null)} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Klubnavn</label>
                <input type="text" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none transition-all text-sm" value={editingWish.club || ''} onChange={e => setEditingWish({...editingWish, club: e.target.value})} placeholder="f.eks. OB" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Årgang</label>
                  <input type="text" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none transition-all text-sm" value={editingWish.age || ''} onChange={e => setEditingWish({...editingWish, age: e.target.value})} placeholder="f.eks. U10 eller Generelt" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Køn</label>
                  <select className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none transition-all text-sm" value={editingWish.koen || 'Ikke angivet'} onChange={e => setEditingWish({...editingWish, koen: e.target.value})}>
                    <option value="Ikke angivet">Ikke angivet</option>
                    <option value="Drenge">Drenge</option>
                    <option value="Piger">Piger</option>
                    <option value="Mix">Mix</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Regeltype</label>
                  <select className={`w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-pink-500 outline-none transition-all text-sm font-bold ${
                    editingWish.ruleType === 'UNKNOWN' ? 'bg-amber-50 border-amber-300 text-amber-800' :
                    editingWish.ruleType === 'FORCE_HOST' ? 'bg-green-50 border-green-300 text-green-800' :
                    editingWish.ruleType === 'AVOID_HOST' ? 'bg-red-50 border-red-300 text-red-800' :
                    editingWish.ruleType === 'OBS' ? 'bg-purple-50 border-purple-300 text-purple-800' :
                    'bg-blue-50 border-blue-300 text-blue-800'
                  }`} value={editingWish.ruleType || 'UNKNOWN'} onChange={e => setEditingWish({...editingWish, ruleType: e.target.value})}>
                    {RULE_TYPES.map(rt => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Niveauer</label>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-3 py-2.5 border border-gray-300 rounded-lg bg-white">
                    {['A', 'B', 'C', 'Blandet', 'Begynder', 'Nystartet'].map(n => (
                      <label key={n} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                        <input type="checkbox"
                          checked={editingWish.niveauer && editingWish.niveauer.includes(n)}
                          onChange={(e) => {
                            const current = (editingWish.niveauer || []).filter(x => x !== 'Ikke angivet');
                            const updated = e.target.checked ? [...current, n] : current.filter(x => x !== n);
                            setEditingWish({...editingWish, niveauer: updated.length ? updated : ['Ikke angivet']});
                          }}
                          className="w-3.5 h-3.5 accent-pink-600 cursor-pointer"
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Ønske-tekst</label>
                <textarea className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none transition-all resize-none h-24 text-sm" value={editingWish.text || ''} onChange={e => setEditingWish({...editingWish, text: e.target.value})} placeholder="Beskriv ønsket..." />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Kontaktperson</label>
                <input type="text" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none transition-all text-sm" value={editingWish.contact || ''} onChange={e => setEditingWish({...editingWish, contact: e.target.value})} placeholder="Navn, email, tlf..." />
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" checked={editingWish.isActive} onChange={() => setEditingWish({...editingWish, isActive: !editingWish.isActive})} className="w-4 h-4 accent-pink-600 cursor-pointer" />
                <label className="text-sm font-bold text-gray-700">Aktiv regel</label>
              </div>

              <div className="mt-6 flex gap-3">
                <button type="button" onClick={() => setEditingWish(null)} className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition-colors text-sm">
                  Annuller
                </button>
                <button type="button" onClick={() => { setWishes(wishes.map(w => w.id === editingWish.id ? editingWish : w)); setEditingWish(null); }} className="flex-1 px-4 py-2.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-bold transition-colors shadow-sm text-sm">
                  Gem ændringer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderVærtsklubberView = () => {
    const currentGroupedByDate = {};
    const dateClubCounts = {};
    
    const allHostings = [];

    previousTournaments.forEach(p => {
       const ageMatch = p.rowName.match(/^(U\d+)/i);
       const ageGroup = ageMatch ? ageMatch[1] : p.rowName.split(' ')[0];
       if (p.dates && p.dates.length > 0) {
          p.dates.forEach(d => {
             allHostings.push({ club: p.club, ageGroup, rowName: p.rowName, date: d, source: 'Tidligere' });
          });
       } else {
          for(let i=0; i<p.count; i++) {
             allHostings.push({ club: p.club, ageGroup, rowName: p.rowName, date: 'Ukendt dato', source: 'Tidligere' });
          }
       }
    });

    data.forEach(row => {
      const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
      const date = dateMatch ? dateMatch[1] : 'Andre';
      const rowName = row.name.replace(/\s*-?\s*\d{1,2}\/\d{1,2}.*/, '').trim() || 'Ikke-kategoriseret';
      const ageMatch = rowName.match(/^(U\d+)/i);
      const ageGroup = ageMatch ? ageMatch[1] : rowName.split(' ')[0];
      
      row.teams.forEach(team => {
        if (team.isHost && !team.isBye && team.poolId !== null) {
          if (!currentGroupedByDate[date]) currentGroupedByDate[date] = {};
          if (!currentGroupedByDate[date][rowName]) currentGroupedByDate[date][rowName] = {};
          if (!currentGroupedByDate[date][rowName][team.club]) currentGroupedByDate[date][rowName][team.club] = 0;
          currentGroupedByDate[date][rowName][team.club]++;

          if (!dateClubCounts[date]) dateClubCounts[date] = {};
          if (!dateClubCounts[date][team.club]) dateClubCounts[date][team.club] = 0;
          dateClubCounts[date][team.club]++;

          allHostings.push({ club: team.club, ageGroup, rowName, date, source: 'Nuværende' });
        }
      });
    });

    const getHostingsTooltip = (club, rowName) => {
       const ageGroupMatch = rowName.match(/^(U\d+)/i);
       const ageGroup = ageGroupMatch ? ageGroupMatch[1] : rowName.split(' ')[0];
       const hostings = allHostings.filter(h => h.club === club && h.ageGroup === ageGroup);
       
       if (hostings.length === 0) return null;

       return (
          <div className="absolute left-8 top-full mt-1 w-64 bg-gray-900 text-white p-3 rounded-lg shadow-xl opacity-0 invisible group-hover/club:opacity-100 group-hover/club:visible transition-all z-[100] text-xs font-normal text-left pointer-events-none">
             <div className="font-bold text-green-300 mb-2 pb-1 border-b border-gray-700">{club} - {ageGroup} Værtsskaber:</div>
             <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {hostings.map((h, i) => (
                   <li key={i} className="flex justify-between items-start gap-2">
                      <span className="truncate flex-1" title={h.rowName}>{h.rowName}</span>
                      <span className={`flex-shrink-0 whitespace-nowrap ${h.source === 'Nuværende' ? 'text-green-400 font-bold' : 'text-gray-400'}`}>{h.date}</span>
                   </li>
                ))}
             </ul>
          </div>
       );
    };

    const parseDateLabel = (label) => {
        if (label === 'Andre') return [99, 99];
        const parts = label.split('/');
        if (parts.length === 2) return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
        return [0, 0];
    };
    
    const sortedDates = Object.keys(currentGroupedByDate).sort((a, b) => {
        const [dayA, monthA] = parseDateLabel(a);
        const [dayB, monthB] = parseDateLabel(b);
        if (monthA !== monthB) return monthA - monthB;
        return dayA - dayB;
    });

    const prevGrouped = {};
    previousTournaments.forEach(p => {
        if (!prevGrouped[p.rowName]) prevGrouped[p.rowName] = {};
        prevGrouped[p.rowName][p.club] = { count: p.count, dates: p.dates || [] };
    });

    return (
      <div className="flex-1 overflow-auto p-8 bg-gray-50 flex flex-col items-center">
        <div className="max-w-6xl w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <MapPin className="w-8 h-8 text-green-600" />
              <div>
                 <h2 className="text-2xl font-bold text-gray-800">Værtsklubber Oversigt</h2>
                 <p className="text-gray-500 text-sm mt-1">Sammenlign nuværende og tidligere værtsklubber. Hold musen over et klubnavn for mere info.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
                <button onClick={() => setShowTransferPrompt(true)} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-sm flex items-center gap-2">
                   <Download className="w-4 h-4" /> Overfør nuværende stævne til tidligere stævner
                </button>
                {(ignoredHostConflicts.length > 0 || ignoredPreviousHosts.length > 0 || ignoredBaneCapacityConflicts.length > 0 || ignoredHostMultiPoolConflicts.length > 0) && (
                  <button onClick={() => { setIgnoredHostConflicts([]); setIgnoredPreviousHosts([]); setIgnoredBaneCapacityConflicts([]); setIgnoredHostMultiPoolConflicts([]); }} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-bold transition-colors shadow-sm">
                    Nulstil ignorerede konflikter
                  </button>
                )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start pb-32">
             {/* Venstre Tabel: Tidligere stævner */}
             <div className="flex flex-col border border-gray-200 rounded-lg bg-white shadow-sm">
               <div className="bg-gray-100 border-b border-gray-200 p-4 flex items-center gap-2 rounded-t-lg">
                  <MapPin className="w-5 h-5 text-gray-500" />
                  <h3 className="font-bold text-gray-800 text-lg">Tidligere stævner</h3>
               </div>
               <div>
                  {Object.keys(prevGrouped).length === 0 && (
                     <div className="p-8 text-center text-gray-400 italic text-sm">
                       Ingen tidligere stævner gemt.
                     </div>
                  )}
                  {Object.entries(prevGrouped).sort((a,b) => a[0].localeCompare(b[0])).map(([rowName, clubs]) => (
                    <div key={rowName} className="border-b border-gray-200 last:border-0">
                       <div className="bg-gray-50 px-4 py-2 font-bold text-sm text-gray-700 border-b border-gray-200 sticky top-0 z-10 flex items-center gap-2">
                         <Trophy className="w-3.5 h-3.5 text-gray-400" /> {rowName}
                       </div>
                       <table className="w-full text-left text-sm">
                          <thead className="bg-white">
                             <tr>
                                <th className="px-4 py-2 text-xs font-semibold text-gray-500 pl-10">Klub</th>
                                <th className="px-4 py-2 text-xs font-semibold text-gray-500 w-28 text-center">Antal stævner</th>
                                <th className="px-4 py-2 text-xs font-semibold text-gray-500 w-32 text-center">Seneste stævne</th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                             {Object.entries(clubs).sort((a,b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([club, data]) => {
                               const latestDate = data.dates && data.dates.length > 0 ? data.dates[data.dates.length - 1] : '-';
                               return (
                                 <tr key={club} className="hover:bg-blue-50 transition-colors">
                                   <td className="px-4 py-2.5 font-medium text-gray-800 pl-10 relative group/club cursor-help w-full">
                                     <span className="border-b border-dashed border-gray-400">{club}</span>
                                     {getHostingsTooltip(club, rowName)}
                                   </td>
                                   <td className="px-4 py-2.5 text-center font-bold text-blue-600">{data.count}</td>
                                   <td className="px-4 py-2.5 text-center text-gray-500 whitespace-nowrap">{latestDate}</td>
                                 </tr>
                               );
                             })}
                          </tbody>
                       </table>
                    </div>
                  ))}
               </div>
             </div>

             {/* Højre Tabel: Nuværende stævne */}
             <div className="flex flex-col border border-gray-200 rounded-lg bg-white shadow-sm">
               <div className="bg-green-600 border-b border-green-700 p-4 flex items-center gap-2 text-white rounded-t-lg">
                  <Calendar className="w-5 h-5" />
                  <h3 className="font-bold text-lg">Nuværende stævne (Samlet overblik)</h3>
               </div>
               <div>
                  {sortedDates.length === 0 && (
                    <div className="p-8 text-center text-gray-400 italic text-sm">
                      Ingen værtsklubber tildelt i puljerne endnu.
                    </div>
                  )}
                  {sortedDates.map(date => (
                    <div key={date} className="border-b border-gray-300 last:border-0">
                       <div className="bg-green-100 px-4 py-2 font-bold text-sm text-green-800 sticky top-0 z-20 border-b border-green-200">
                         Spilledato: {date}
                       </div>
                       {Object.entries(currentGroupedByDate[date]).sort((a,b) => a[0].localeCompare(b[0])).map(([rowName, clubs]) => (
                         <div key={rowName} className="border-b border-gray-200 last:border-0">
                           <div className="bg-gray-50 px-4 py-1.5 font-semibold text-xs text-gray-700 border-b border-gray-200 sticky top-[36px] z-10 flex items-center gap-2">
                             <Trophy className="w-3.5 h-3.5 text-gray-500" /> {rowName}
                           </div>
                           <table className="w-full text-left text-sm">
                             <thead className="bg-white">
                               <tr>
                                 <th className="px-4 py-2 text-xs font-semibold text-gray-500 pl-10">Klub</th>
                                 <th className="px-4 py-2 text-xs font-semibold text-gray-500 w-32 text-center">Antal stævner</th>
                               </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-100">
                               {Object.entries(clubs).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([club, count]) => {
                                 const isConflict = dateClubCounts[date][club] > 1;
                                 return (
                                   <tr key={club} className={`transition-colors ${isConflict ? 'bg-orange-50 hover:bg-orange-100' : 'hover:bg-blue-50'}`}>
                                     <td className={`px-4 py-2.5 font-medium pl-10 flex items-center gap-1.5 relative group/club cursor-help ${isConflict ? 'text-orange-800' : 'text-gray-800'}`}>
                                       <span className="border-b border-dashed border-current">{club}</span>
                                       {isConflict && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-orange-500" title={`Advarsel: ${club} er vært ${dateClubCounts[date][club]} gange på denne dato!`} />}
                                       {getHostingsTooltip(club, rowName)}
                                     </td>
                                     <td className={`px-4 py-2.5 text-center font-bold ${isConflict ? 'text-orange-700' : 'text-blue-600'}`}>{count}</td>
                                   </tr>
                                 );
                               })}
                             </tbody>
                           </table>
                         </div>
                       ))}
                    </div>
                  ))}
               </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  const renderNøglerView = () => {
    // 5:5 data
    const selectedTemplateData = fodaMatrices[selectedFodaTemplate] || Object.values(fodaMatrices)[0];
    const matrix = selectedTemplateData.matrix;
    const size = selectedTemplateData.size;

    const templatesBySize = Object.keys(fodaMatrices).reduce((acc, key) => {
      const tSize = fodaMatrices[key].size;
      if (!acc[tSize]) acc[tSize] = [];
      acc[tSize].push(key);
      return acc;
    }, {});

    const counts = matrix.map(row => row.reduce((sum, val) => sum + val, 0));
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);

    // 3:3 data
    const selectedTemplateData3v3 = fodaMatrices3v3[selectedFodaTemplate3v3] || Object.values(fodaMatrices3v3)[0];
    const matrix3v3 = selectedTemplateData3v3.matrix;
    const size3v3 = selectedTemplateData3v3.size;

    const templatesBySize3v3 = Object.keys(fodaMatrices3v3).reduce((acc, key) => {
      const tSize = fodaMatrices3v3[key].size;
      if (!acc[tSize]) acc[tSize] = [];
      acc[tSize].push(key);
      return acc;
    }, {});

    const counts3v3 = matrix3v3.map(row => row.reduce((sum, val) => sum + val, 0));
    const maxCount3v3 = Math.max(...counts3v3);
    const minCount3v3 = Math.min(...counts3v3);

    // Determine which data set to use based on format
    const is3v3 = nøglerFormat === '3:3';
    const activeMatrix = is3v3 ? matrix3v3 : matrix;
    const activeSize = is3v3 ? size3v3 : size;
    const activeCounts = is3v3 ? counts3v3 : counts;
    const activeMaxCount = is3v3 ? maxCount3v3 : maxCount;
    const activeMinCount = is3v3 ? minCount3v3 : minCount;
    const activeSelected = is3v3 ? selectedFodaTemplate3v3 : selectedFodaTemplate;
    const activeCustomHostKeys = is3v3 ? customHostKeys3v3 : customHostKeys;
    const activeGetBestHostKey = getBestHostKey;
    const activeHandleHostKeyChange = is3v3 ? handleCustomHostKeyChange3v3 : handleCustomHostKeyChange;
    const activeTemplatesBySize = is3v3 ? templatesBySize3v3 : templatesBySize;
    const activeDefaultTemplates = is3v3 ? defaultTemplates3v3 : defaultTemplates;
    const activeSetSelected = is3v3 ? setSelectedFodaTemplate3v3 : setSelectedFodaTemplate;
    const activeHandleSetDefault = is3v3 ? handleSetDefaultTemplate3v3 : handleSetDefaultTemplate;
    const activeSchedules = is3v3 ? predefinedSchedules3v3 : predefinedSchedules;

    return (
      <div className="flex-1 flex overflow-hidden bg-gray-50">
        <div className="w-[300px] bg-white border-r border-gray-200 flex flex-col shadow-sm z-10 flex-shrink-0">
          <div className="px-4 py-4 mb-2 text-sm font-bold text-gray-700 uppercase tracking-wider border-b flex items-center justify-between">
            <span>Skabeloner</span>
            <div className="flex rounded-lg overflow-hidden border border-gray-300">
              <button
                onClick={() => setNøglerFormat('3:3')}
                className={`px-3 py-1 text-xs font-bold transition-colors ${nøglerFormat === '3:3' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
              >
                3:3
              </button>
              <button
                onClick={() => setNøglerFormat('5:5')}
                className={`px-3 py-1 text-xs font-bold transition-colors border-l border-gray-300 ${nøglerFormat === '5:5' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
              >
                5:5
              </button>
            </div>
          </div>
          <ul className="space-y-1 px-2 overflow-y-auto pb-6">
            {Object.keys(activeTemplatesBySize).sort((a,b)=>a-b).map(sizeStr => (
              <div key={sizeStr} className="mb-4">
                 <div className="text-xs font-bold text-gray-400 mb-1 ml-1 uppercase">{sizeStr} hold</div>
                 {activeTemplatesBySize[sizeStr].map(templateName => {
                    const isDefault = activeDefaultTemplates[sizeStr] === templateName;
                    const isSelected = activeSelected === templateName;
                    return (
                       <li key={templateName} className="flex flex-col mb-1 group">
                          <div className="flex items-stretch">
                              <button
                                onClick={() => activeSetSelected(templateName)}
                                className={`flex-1 text-left px-3 py-2 rounded-l-lg transition-colors duration-150 text-xs font-medium border border-transparent border-r-0 ${isSelected ? 'bg-green-50 text-green-700 border-green-200' : 'text-gray-600 hover:bg-gray-100 group-hover:border-gray-200'}`}
                              >
                                {templateName}
                              </button>
                              <button
                                  onClick={() => activeHandleSetDefault(sizeStr, templateName)}
                                  title={isDefault ? "Dette er standard skabelonen for " + sizeStr + " hold" : "Sæt som standard for " + sizeStr + " hold"}
                                  className={`px-2 flex items-center justify-center rounded-r-lg transition-colors border ${isDefault ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white text-gray-300 border-transparent group-hover:border-gray-200 hover:bg-gray-50 hover:text-gray-500'}`}
                              >
                                  <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-current' : ''}`} />
                              </button>
                          </div>
                       </li>
                    );
                 })}
              </div>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-auto p-8 flex flex-col items-center">
          <div className="max-w-5xl w-full">

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full">
              <div className="flex items-center gap-3 mb-6">
                <Key className="w-8 h-8 text-green-600" />
                <h2 className="text-2xl font-bold text-gray-800">Foda Nøgler - {activeSize} hold {is3v3 ? '(3:3)' : '(5:5)'}</h2>
              </div>
              <p className="text-gray-600 mb-6 border-b border-gray-100 pb-6">
                {isAllMeetAll(activeMatrix)
                  ? <>Skabelonen <strong>{activeSelected}</strong> er en skabelon hvor alle hold møder hinanden. Der er derfor ingen nøglekonflikter mulige.</>
                  : <>Nedenfor ser du matrixen for skabelonen <strong>{activeSelected}</strong>. De røde krydser markerer de hold, som <strong>IKKE</strong> mødes. Brug dette til at placere dine hold på de rigtige nøgler.</>
                }
              </p>

              <div className="bg-blue-50 p-6 rounded-xl border border-blue-200 mb-8 flex flex-col sm:flex-row justify-between items-center gap-4">
                 <div>
                    <h3 className="font-bold text-blue-900 mb-1 flex items-center gap-2"><MapPin className="w-4 h-4" /> Standard Værtsklub Nøgle</h3>
                    <p className="text-sm text-blue-700">Vælg hvilken nøgle der som standard skal tildeles værtsklubben, når denne skabelon benyttes.</p>
                 </div>
                 <select
                    value={activeCustomHostKeys[activeSelected] || activeGetBestHostKey(activeSelected, {})}
                    onChange={(e) => activeHandleHostKeyChange(activeSelected, parseInt(e.target.value))}
                    className="bg-white border border-blue-300 text-blue-900 font-bold rounded-lg px-4 py-2.5 shadow-sm outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer min-w-[150px]"
                 >
                    {Array.from({length: activeSize}).map((_, i) => {
                       const isBest = (activeMaxCount > activeMinCount) && (activeCounts[i] === activeMaxCount);
                       return (
                         <option key={i} value={i+1}>
                            Nøgle {i+1} {isBest ? '(Flest kampe)' : ''}
                         </option>
                       );
                    })}
                 </select>
              </div>

              {isAllMeetAll(activeMatrix) ? (
                <div className="bg-green-50 p-8 rounded-xl border border-green-200 mb-8 text-center">
                  <Check className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <h3 className="font-bold text-green-800 text-lg mb-2">Alle hold møder alle andre hold</h3>
                  <p className="text-green-700 text-sm">I denne skabelon møder hvert hold alle andre hold. Der er ingen nøglekonflikter mulige, og matrixen er derfor ikke nødvendig at vise.</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto mb-8">
                    <table className="w-full text-center border-collapse">
                      <thead>
                        <tr>
                          <th className="p-3 bg-gray-50 border border-gray-200 text-gray-600 font-bold whitespace-nowrap">Nøgle \ Nøgle</th>
                          {Array.from({length: activeSize}).map((_, i) => (
                            <th key={i} className="p-3 bg-gray-50 border border-gray-200 text-gray-800 font-bold whitespace-nowrap">Nøgle {i + 1}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeMatrix.map((row, i) => (
                          <tr key={i}>
                            <td className="p-3 bg-gray-50 border border-gray-200 font-bold text-gray-800 text-left pl-4 whitespace-nowrap">Nøgle {i + 1}</td>
                            {row.map((val, j) => {
                              if (i === j) return <td key={j} className="p-3 border border-gray-200 bg-gray-100"></td>;
                              if (val >= 1) return <td key={j} className="p-3 border border-gray-200 bg-green-50 text-green-600"><Check className="w-5 h-5 mx-auto" /></td>;
                              return <td key={j} className="p-3 border border-gray-200 bg-red-50 text-red-500 font-bold"><X className="w-5 h-5 mx-auto" /></td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(() => {
                    const lastOpp = getLastOpponents(activeSelected, activeMatrix, activeSchedules);
                    return (
                      <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                        <h3 className="font-bold text-gray-800 mb-4">Oversigt: Hvem møder IKKE hinanden?</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {activeMatrix.map((row, i) => {
                            const missing = [];
                            row.forEach((val, j) => {
                              if (i !== j && val === 0) missing.push(j + 1);
                            });
                            return (
                              <div key={i} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                <div className="font-bold text-gray-700 mb-1 text-lg">{i + 1}</div>
                                {missing.length > 0 ? (
                                  <div className="text-sm text-red-600 flex items-center gap-1.5"><X className="w-4 h-4 flex-shrink-0" /> Misser: {missing.join(', ')}</div>
                                ) : (
                                  <div className="text-sm text-green-600 flex items-center gap-1.5"><Check className="w-4 h-4 flex-shrink-0" /> Møder alle andre</div>
                                )}
                                {lastOpp[i + 1] && (
                                  <div className="text-xs text-gray-500 mt-1">Sidste kamp: mod {lastOpp[i + 1]}</div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    );
                  })()}

                </>
              )}

              {/* Hvem møder hinanden 2+ gange - vises uafhængigt af isAllMeetAll */}
              {(() => {
                const dobbeltPairs = [];
                let totalPairs = 0;
                for (let i = 0; i < activeMatrix.length; i++) {
                  for (let j = i + 1; j < activeMatrix[i].length; j++) {
                    totalPairs++;
                    if (activeMatrix[i][j] >= 2) {
                      dobbeltPairs.push({ a: i + 1, b: j + 1, count: activeMatrix[i][j] });
                    }
                  }
                }
                // Skip if no dobbelt pairs, or if ALL pairs are dobbelt (complete dobbelt template)
                if (dobbeltPairs.length === 0 || dobbeltPairs.length === totalPairs) return null;

                // Group by key number for the per-key view
                const meetMultiple = {};
                dobbeltPairs.forEach(({ a, b, count }) => {
                  if (!meetMultiple[a]) meetMultiple[a] = [];
                  meetMultiple[a].push({ key: b, count });
                  if (!meetMultiple[b]) meetMultiple[b] = [];
                  meetMultiple[b].push({ key: a, count });
                });

                const lastOpp = getLastOpponents(activeSelected, activeMatrix, activeSchedules);

                return (
                  <div className="bg-amber-50 p-6 rounded-xl border border-amber-200 mt-6">
                    <h3 className="font-bold text-amber-800 mb-2">Oversigt: Hvem møder hinanden 2+ gange?</h3>
                    <p className="text-amber-700 text-sm mb-4">Disse nøgler møder hinanden mere end én gang i skabelonen. Vær opmærksom på dette ved nøgletildeling.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Array.from({ length: activeMatrix.length }).map((_, i) => {
                        const partners = meetMultiple[i + 1] || [];
                        if (partners.length === 0) return null;
                        return (
                          <div key={i} className="bg-white p-3 rounded-lg border border-amber-200 shadow-sm">
                            <div className="font-bold text-gray-700 mb-1 text-lg">{i + 1}</div>
                            <div className="text-sm text-amber-700 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Møder {partners.map(p => `${p.key} (${p.count}x)`).join(', ')}
                            </div>
                            {lastOpp[i + 1] && (
                              <div className="text-xs text-gray-500 mt-1">Sidste kamp: mod {lastOpp[i + 1]}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <KampprogramView templateName={activeSelected} matrix={activeMatrix} schedules={activeSchedules} />

          </div>
        </div>
      </div>
    );
  };

  const currentColumnOrder = activeRow.columnOrder || ['unassigned', ...activeRow.pools.map(p => p.id)];

  // Filtreringsmuligheder udledt fra rækkenavne
  // Parser årgang, niveau og køn fra rækkenavn — håndterer fx "U7 Blandet Niveau dr.", "U11 Nystartet pi.", "U9 A dr."
  const parseRowName = (name) => {
    // Håndterer: "U9 B dr.", "U7 Bl. Niveau dr.", "U6 mix", "U7/U8 pi.", "U11/12 C dr."
    const m = name.match(/^(U\d+(?:\/U?\d+)?)\s+(?:(.+?)\s+)?(dr\.|pi\.|mix)/i);
    if (!m) return null;
    const argang = m[1].toUpperCase();
    const rawNiveau = (m[2] || '').trim();
    let niveau;
    if (!rawNiveau) {
      niveau = null; // Ingen niveau (f.eks. "U6 mix", "U7/U8 pi.")
    } else if (/^[A-Za-z]$/.test(rawNiveau)) {
      niveau = rawNiveau.toUpperCase();
    } else {
      const firstWord = rawNiveau.split(/\s+/)[0];
      niveau = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    }
    const koen = m[3].toLowerCase();
    return { argang, niveau, koen };
  };

  const rowFilterOptions = useMemo(() => {
    const årgange = new Set();
    const niveauer = new Set();
    const køn = new Set();
    const formater = new Set();
    const datoer = new Set();
    data.forEach(row => {
      const parsed = parseRowName(row.name);
      if (parsed) {
        årgange.add(parsed.argang);
        if (parsed.niveau) niveauer.add(parsed.niveau);
        køn.add(parsed.koen);
      }
      if (row.name.includes('3:3')) formater.add('3:3');
      if (row.name.includes('5:5')) formater.add('5:5');
      if (row.name.includes('8:8')) formater.add('8:8');
      const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
      if (dateMatch) datoer.add(dateMatch[1]);
    });
    return {
      årgange: [...årgange].sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0])),
      niveauer: [...niveauer].sort(),
      køn: [...køn].sort(),
      formater: [...formater].sort(),
      datoer: [...datoer].sort((a, b) => {
        const [dA, mA] = a.split('/').map(Number);
        const [dB, mB] = b.split('/').map(Number);
        return mA !== mB ? mA - mB : dA - dB;
      })
    };
  }, [data]);

  // Filtreret data baseret på aktive filtre
  const filteredRowIds = useMemo(() => {
    const ids = new Set();
    data.forEach(row => {
      const parsed = parseRowName(row.name);
      if (rowFilterArgang !== 'ALL' && (!parsed || parsed.argang !== rowFilterArgang)) return;
      if (rowFilterNiveau !== 'ALL' && (!parsed || parsed.niveau !== rowFilterNiveau)) return;
      if (rowFilterKoen !== 'ALL' && (!parsed || parsed.koen !== rowFilterKoen)) return;
      if (rowFilterFormat !== 'ALL' && !row.name.includes(rowFilterFormat)) return;
      if (rowFilterDato !== 'ALL') {
        const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
        if (!dateMatch || dateMatch[1] !== rowFilterDato) return;
      }
      ids.add(row.id);
    });
    return ids;
  }, [data, rowFilterArgang, rowFilterNiveau, rowFilterKoen, rowFilterFormat, rowFilterDato]);

  // Beregn alle multi-pool host assignments globalt (til multi-pool indikator)
  const allHostAssignments = useMemo(() => {
    const map = {};
    data.forEach(r => {
      r.pools.forEach(pool => {
        const host = r.teams.find(t => t.poolId === pool.id && t.isHost && !t.isBye);
        if (host) {
          if (!map[host.club]) map[host.club] = [];
          map[host.club].push({ rowId: r.id, rowName: r.name, poolId: pool.id, poolName: pool.name });
        }
      });
    });
    return map;
  }, [data]);

  const hasActiveRowFilter = rowFilterArgang !== 'ALL' || rowFilterNiveau !== 'ALL' || rowFilterKoen !== 'ALL' || rowFilterFormat !== 'ALL' || rowFilterDato !== 'ALL';

  const visibleData = hideFilteredRows && hasActiveRowFilter ? data.filter(r => filteredRowIds.has(r.id)) : data;

  const groupedRows = visibleData.reduce((acc, row) => {
    const dateMatch = row.name.match(/ (\d{1,2}\/\d{1,2})/);
    const dateLabel = dateMatch ? `${dateMatch[1]}` : 'Andre';
    if (!acc[dateLabel]) acc[dateLabel] = [];
    acc[dateLabel].push(row);
    return acc;
  }, {});

  const parseDateLabel = (label) => {
      if (label === 'Andre') return [99, 99];
      const parts = label.split('/');
      if (parts.length === 2) {
          return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
      }
      return [0, 0];
  };

  const sortedDateLabels = Object.keys(groupedRows).sort((a, b) => {
      const [dayA, monthA] = parseDateLabel(a);
      const [dayB, monthB] = parseDateLabel(b);
      if (monthA !== monthB) return monthA - monthB;
      return dayA - dayB;
  });

  const pdfPages = [];
  let currentPageElements = [];

  const pdfSourceData = hideFilteredRows && hasActiveRowFilter ? data.filter(r => filteredRowIds.has(r.id)) : data;
  pdfSourceData.filter(row => row.teams.length > 0).forEach(row => {
    const printOrder = (row.columnOrder || []).filter(id => id !== 'unassigned');
    if (printOrder.length === 0) return;

    printOrder.forEach((colId) => {
      if (currentPageElements.length >= 8) {
        pdfPages.push(currentPageElements);
        currentPageElements = [];
      }

      const pool = row.pools.find(p => p.id === colId);
      if (pool) {
        currentPageElements.push({
          type: 'pool',
          id: `${row.id}-${pool.id}`,
          pool,
          row
        });
      }
    });
  });

  if (currentPageElements.length > 0) {
    pdfPages.push(currentPageElements);
  }

  const activeDatesForPdf = Array.from(new Set(data.filter(r => r.teams.length > 0).map(r => {
    const match = r.name.match(/\d{1,2}\/\d{1,2}/);
    return match ? match[0] : null;
  }).filter(Boolean)));
  
  activeDatesForPdf.sort((a, b) => {
    const [dayA, monthA] = a.split('/').map(Number);
    const [dayB, monthB] = b.split('/').map(Number);
    return monthA !== monthB ? monthA - monthB : dayA - dayB;
  });

  const pdfDatesText = activeDatesForPdf.length > 0 ? `- Spilledatoer: ${activeDatesForPdf.join(', ')}` : '';

  const renderHjælpView = () => (
    <div className="flex-1 overflow-auto p-4 md:p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-3">
            <HelpCircle className="w-8 h-8 text-green-600" />
            <h2 className="text-2xl md:text-3xl font-bold text-gray-800">Hjælp & Vejledning</h2>
          </div>
          <p className="text-gray-500 text-sm">Overblik over StævnePlan — hvad de enkelte funktioner gør, og hvordan stævner planlægges.</p>
        </div>

        {/* Workflow */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><Zap className="w-5 h-5 text-amber-500" /> Sådan bruger du StævnePlan</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { nr: '1', titel: 'Importer rækker', tekst: 'Upload turneringsdata (RækkePuljeOversigt .xls) fra foda. Holdene fordeles automatisk i rækker.' },
              { nr: '2', titel: 'Upload ønsker', tekst: 'Upload klubbernes ønskefil (Excel/CSV). Ønsker klassificeres automatisk som regler.' },
              { nr: '3', titel: 'Sæt kriterier', tekst: 'Vælg hvilke regler der skal styre fordelingen (undgå samme klub, banekapacitet, osv.).' },
              { nr: '4', titel: 'Fordel hold', tekst: 'Klik "Fordel ALLE" for at fordele alle hold i puljer. Algoritmen fordeler hold efter ønsker, kriterier, værtsklubsfordeling og geografiske hensyn.' },
              { nr: '5', titel: 'Validér', tekst: 'Klik "Validér" for at tjekke banekapacitet, konflikter og uopfyldte ønsker.' },
              { nr: '6', titel: 'Download PDF', tekst: 'Eksporter den færdige stævneplan som PDF med 8 puljer per side.' },
            ].map(s => (
              <div key={s.nr} className="flex gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">{s.nr}</span>
                <div>
                  <div className="font-bold text-sm text-gray-800">{s.titel}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.tekst}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs forklaring */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><LayoutGrid className="w-5 h-5 text-blue-500" /> Faner (tabs)</h3>
          <div className="space-y-3">
            {[
              { ikon: <LayoutGrid className="w-4 h-4 text-green-600" />, navn: 'Rækker', tekst: 'Hovedvisningen. Importer turneringsrækker, se hold, opret puljer, fordel hold og træk dem mellem puljer. Herfra kan du også fordele alle rækker og validere hele stævneplanen.' },
              { ikon: <Key className="w-4 h-4 text-amber-600" />, navn: 'Nøgler', tekst: 'Kampskabeloner (nøgler) for hver puljestørrelse. Definerer rækkefølgen af kampe — f.eks. for en 4-holds pulje: kamp 1 vs 2, kamp 3 vs 4, osv. Du kan redigere og oprette egne nøgler.' },
              { ikon: <Settings className="w-4 h-4 text-gray-600" />, navn: 'Kriterier', tekst: 'Regler der styrer den automatiske fordeling. Bestemmer om algoritmen skal undgå hold fra samme klub, tjekke banekapacitet, prioritere geografisk nærhed osv.' },
              { ikon: <Sparkles className="w-4 h-4 text-pink-600" />, navn: 'Ønsker', tekst: 'Klubbernes individuelle ønsker uploadet fra Excel/CSV. Hvert ønske klassificeres automatisk som en regeltype (vært, undgå vært, OBS osv.) og kan redigeres manuelt.' },
              { ikon: <MapIcon className="w-4 h-4 text-indigo-600" />, navn: 'Baner', tekst: 'Oversigt over hver klubs banekapacitet — antal 3:3, 5:5 og 8:8 baner. Bruges til at validere at værtsklubber har nok baner til deres puljer.' },
              { ikon: <MapPin className="w-4 h-4 text-red-600" />, navn: 'Værtsklubber', tekst: 'Overblik over hvilke klubber der er tildelt som vært, for hvilke rækker, og på hvilke datoer. Viser også historik fra tidligere stævner.' },
            ].map(t => (
              <div key={t.navn} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <span className="mt-0.5 flex-shrink-0">{t.ikon}</span>
                <div>
                  <div className="font-bold text-sm text-gray-800">{t.navn}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t.tekst}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Regeltyper */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><Wand2 className="w-5 h-5 text-pink-500" /> Regeltyper (Ønsker)</h3>
          <p className="text-xs text-gray-500 mb-3">Når klubber uploader ønsker, klassificeres de automatisk som en af følgende regeltyper. Regeltypen bestemmer hvad algoritmen gør med ønsket.</p>
          <div className="space-y-2">
            {[
              { id: 'FORCE_HOST', farve: 'bg-green-100 border-green-300 text-green-800', tekst: 'Klubben SKAL være vært for denne række/årgang. Algoritmen tildeler klubben som vært.' },
              { id: 'AVOID_HOST', farve: 'bg-red-100 border-red-300 text-red-800', tekst: 'Klubben må IKKE tildeles som vært. Algoritmen springer klubben over ved værtstildeling.' },
              { id: 'SAME_POOL', farve: 'bg-blue-100 border-blue-300 text-blue-800', tekst: 'To eller flere hold skal placeres i samme pulje. Bruges når klubber ønsker at spille mod hinanden.' },
              { id: 'SAME_LOCATION', farve: 'bg-blue-100 border-blue-300 text-blue-800', tekst: 'Hold skal spille på samme lokation/bane. Relateret til værtskab.' },
              { id: 'AVOID_CLUB', farve: 'bg-blue-100 border-blue-300 text-blue-800', tekst: 'Klubben ønsker ikke at møde en bestemt modstander i puljen.' },
              { id: 'OBS', farve: 'bg-purple-100 border-purple-300 text-purple-800', tekst: 'Information til planlæggeren. Ingen automatisk handling — vises som note ved ønsket.' },
              { id: 'UNKNOWN', farve: 'bg-amber-100 border-amber-300 text-amber-800', tekst: 'Ønsket kunne ikke klassificeres automatisk. Kræver manuel gennemgang — klik redigér for at tildele regeltype.' },
            ].map(r => (
              <div key={r.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-100">
                <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold border ${r.farve}`}>
                  {RULE_TYPES.find(rt => rt.id === r.id)?.label || r.id}
                </span>
                <span className="text-xs text-gray-600 mt-0.5">{r.tekst}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Kriterier forklaring */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><Target className="w-5 h-5 text-indigo-500" /> Fordelingskriterier</h3>
          <p className="text-xs text-gray-500 mb-3">Kriterierne styrer hvordan algoritmen fordeler hold i puljer og tildeler værtsklubber. Slå dem til/fra under Kriterier-fanen.</p>
          <div className="space-y-2">
            {[
              { navn: 'Undgå hold fra samme klub i pulje', tekst: 'Fordeler hold så to hold fra samme klub ikke havner i samme pulje. F.eks. vil "OB 1" og "OB 2" blive fordelt i forskellige puljer.' },
              { navn: 'Auto-tildel værtsklub', tekst: 'Vælger automatisk en værtsklub for hver pulje baseret på banekapacitet, historik og ønsker.' },
              { navn: 'Vært får flest kampe', tekst: 'Placerer værtsklubben på den position i puljen der giver flest kampe (typisk plads 1).' },
              { navn: 'Undgå flere værtskaber samme dag', tekst: 'Sørger for at én klub ikke tildeles som vært for flere puljer på samme spilledag.' },
              { navn: 'Undgå gentagelser fra tidligere stævner', tekst: 'Klubber der var vært sidst bliver nedprioriteret, så værtskabet fordeles mere retfærdigt.' },
              { navn: 'Tjek banekapacitet', tekst: 'Validerer at værtsklubben har nok baner af den rigtige størrelse (3:3, 5:5 eller 8:8) til puljen.' },
              { navn: 'Undgå utilstrækkelig banekapacitet', tekst: 'Forhindrer tildeling af værtsklub hvis klubben ikke har nok baner. Adskiller sig fra "Tjek" ved at blokere i stedet for kun at advare.' },
              { navn: 'Prioriter nyt værtskab i aldersgruppe', tekst: 'Fordeler værtskaber bredt mellem klubber indenfor samme aldersgruppe, så alle klubber prøver at være vært.' },
              { navn: 'Geografisk nærhed', tekst: 'Prøver at samle hold der ligger geografisk tæt på hinanden i samme pulje, så transporttiden minimeres.' },
            ].map(k => (
              <div key={k.navn} className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                <div className="font-bold text-xs text-gray-800">{k.navn}</div>
                <div className="text-xs text-gray-500 mt-0.5">{k.tekst}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Fordelingsalgoritme */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><Shuffle className="w-5 h-5 text-green-500" /> Fordelingsalgoritmen</h3>
          <p className="text-xs text-gray-500 mb-3">Når du klikker "Fordel række" eller "Fordel ALLE", sker følgende:</p>
          <div className="space-y-2">
            {[
              { nr: '1', tekst: 'Værtsklubber vælges FØRST for alle puljer — FORCE_HOST-ønsker har prioritet, derefter filtreres efter banekapacitet, historik og ønsker.' },
              { nr: '2', tekst: 'Hold fordeles i puljer efter geografisk nærhed til puljens værtsklub. Mindste pulje prioriteres ved lige afstand.' },
              { nr: '3', tekst: 'SAME_POOL- og AVOID_CLUB-regler respekteres — hold placeres kun i valide puljer.' },
              { nr: '4', tekst: 'Undgå-samme-klub sikrer at to hold fra samme klub ikke havner i samme pulje.' },
              { nr: '5', tekst: 'Geografisk optimering polerer fordelingen ved at bytte hold der er tættere på en anden pulje.' },
              { nr: '6', tekst: 'Puljer med for få hold fyldes op med oversiddere. Værten placeres på positionen med flest kampe.' },
            ].map(s => (
              <div key={s.nr} className="flex gap-3 items-start p-2 pl-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold mt-0.5">{s.nr}</span>
                <span className="text-xs text-gray-600">{s.tekst}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Import-formater */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><FileText className="w-5 h-5 text-orange-500" /> Importformater</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="font-bold text-sm text-gray-800 mb-1">Turneringsdata (Rækker)</div>
              <div className="text-xs text-gray-500 space-y-1">
                <p>HTML-xls fil fra foda (RækkePuljeOversigt).</p>
                <p>Indeholder rækker, holdnavne og spilledatoer.</p>
                <p>Upload via "Importer rækker" i Rækker-fanen.</p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="font-bold text-sm text-gray-800 mb-1">Ønsker</div>
              <div className="text-xs text-gray-500 space-y-1">
                <p>Excel (.xlsx) eller CSV med 4 kolonner:</p>
                <p className="font-medium text-gray-700">Klub | Årgang | Ønske | Kontaktperson</p>
                <p>Upload via "Upload ønskefil" i Ønsker-fanen.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Knapper forklaring */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4"><Wrench className="w-5 h-5 text-gray-500" /> Vigtige knapper</h3>
          <div className="space-y-2">
            {[
              { navn: 'Fordel række', tekst: 'Fordeler holdene i den valgte række i puljer baseret på algoritmen og kriterierne.' },
              { navn: 'Fordel ALLE', tekst: 'Fordeler alle rækker på én gang. Eksisterende fordelinger nulstilles.' },
              { navn: 'Auto-tilpas', tekst: 'Justerer automatisk antal puljer og puljestørrelse for den valgte række baseret på holdantal.' },
              { navn: 'Validér', tekst: 'Kører en fuld validering: tjekker banekapacitet, uopfyldte ønsker, konflikter og dobbelt-værtskaber.' },
              { navn: 'Gem / Åbn', tekst: 'Gem hele stævneplanen som JSON-fil, eller åbn en tidligere gemt plan.' },
              { navn: 'PDF', tekst: 'Eksporter den færdige stævneplan som PDF — 8 puljer per side med sidetal.' },
            ].map(k => (
              <div key={k.navn} className="flex items-start gap-3 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                <span className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">{k.navn}</span>
                <span className="text-xs text-gray-600 mt-0.5">{k.tekst}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );

  return (
    <>
      <div className="print:hidden flex flex-col h-screen bg-gray-50 font-sans text-gray-800 overflow-hidden">
        
        <div className="bg-green-700 text-white h-10 flex items-center justify-between px-4 shadow-md z-20 shrink-0 gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 font-bold text-base">
              <span className="text-lg">⚽</span>
              StævnePlan
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveTab('rækker')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'rækker' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <LayoutGrid className="w-4 h-4" /> Rækker
              </button>
              <button onClick={() => setActiveTab('nøgler')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'nøgler' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <Key className="w-4 h-4" /> Nøgler
              </button>
              <button onClick={() => setActiveTab('kriterier')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'kriterier' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <Settings className="w-4 h-4" /> Kriterier
              </button>
              <button onClick={() => setActiveTab('ønsker')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'ønsker' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <Sparkles className="w-4 h-4" /> Ønsker
              </button>
              <button onClick={() => setActiveTab('baner')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'baner' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <MapIcon className="w-4 h-4" /> Baner
              </button>
              <button onClick={() => setActiveTab('værtsklubber')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'værtsklubber' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <MapPin className="w-4 h-4" /> Værtsklubber
              </button>
              <button onClick={() => setActiveTab('hjælp')} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors text-sm ${activeTab === 'hjælp' ? 'bg-green-800 text-white shadow-inner' : 'text-green-50 hover:bg-green-600'}`}>
                <HelpCircle className="w-4 h-4" /> Hjælp
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <input type="file" accept=".json" ref={projectInputRef} onChange={handleLoadProject} className="hidden" />
            <button 
              onClick={() => projectInputRef.current?.click()}
              className="flex items-center gap-2 text-white px-3 py-1.5 rounded-md font-medium transition-colors text-sm border border-green-600 bg-green-800 hover:bg-green-900 shadow-sm"
              title="Åbn et tidligere gemt projekt"
            >
              <FolderOpen className="w-4 h-4" /> Åbn
            </button>
            <button 
              onClick={handleSaveProject}
              className="flex items-center gap-2 text-white px-3 py-1.5 rounded-md font-medium transition-colors text-sm border border-green-600 bg-green-800 hover:bg-green-900 shadow-sm"
              title="Gem dit arbejde som en fil"
            >
              <Save className="w-4 h-4" /> Gem
            </button>
            <button 
              onClick={handleDownloadPDF} 
              disabled={isGeneratingPDF}
              className={`flex items-center gap-2 text-white px-3 py-1.5 rounded-md font-medium transition-colors text-sm border shadow-sm ${isGeneratingPDF ? 'bg-gray-500 border-gray-600 cursor-wait' : 'bg-green-800 hover:bg-green-900 border-green-600'}`}
            >
              {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {isGeneratingPDF ? 'Genererer...' : 'PDF'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {activeTab === 'kriterier' && renderKriterierView()}
          {activeTab === 'ønsker' && renderØnskerView()}
          {activeTab === 'baner' && <BanerView clubs={clubs} setClubs={setClubs} />}
          {activeTab === 'nøgler' && renderNøglerView()}
          {activeTab === 'værtsklubber' && renderVærtsklubberView()}
          {activeTab === 'hjælp' && renderHjælpView()}
          {activeTab === 'rækker' && (
            <>
              <div style={{ width: `${sidebarWidth}px` }} className="bg-white border-r border-gray-200 flex flex-col shadow-sm z-10 flex-shrink-0">
                <div className="flex-1 overflow-y-auto py-2">
                  <div className="px-4 mb-1 text-sm font-bold text-gray-700 uppercase tracking-wider border-b pb-1 mx-2 flex justify-between items-center">
                    <span>Rækker</span>
                    <div className="flex items-center gap-1.5">
                      {hasActiveRowFilter && <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">{filteredRowIds.size}/{data.length}</span>}
                      <button onClick={() => setRowFilterOpen(true)}
                        className={`p-1 rounded-md transition-colors ${hasActiveRowFilter ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                        title="Filtrér rækker">
                        <Filter className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Aktive filter-badges */}
                  {hasActiveRowFilter && (
                    <div className="px-3 pb-2 flex flex-wrap gap-1">
                      {rowFilterArgang !== 'ALL' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">{rowFilterArgang}</span>}
                      {rowFilterNiveau !== 'ALL' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">{rowFilterNiveau}</span>}
                      {rowFilterKoen !== 'ALL' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-100 text-pink-700">{rowFilterKoen === 'dr.' ? 'Drenge' : rowFilterKoen === 'pi.' ? 'Piger' : rowFilterKoen === 'mix' ? 'Mix' : rowFilterKoen}</span>}
                      {rowFilterFormat !== 'ALL' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">{rowFilterFormat}</span>}
                      {rowFilterDato !== 'ALL' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">{rowFilterDato}</span>}
                    </div>
                  )}

                  {sortedDateLabels.map(dateLabel => {
                    const rows = groupedRows[dateLabel];
                    return (
                      <div key={dateLabel} className="mb-3">
                        <div className="px-4 mb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                          <Calendar className="w-3 h-3" />
                          {dateLabel === 'Andre' ? 'Rækker (Ingen dato)' : `Spilledato: ${dateLabel}`}
                        </div>
                        <ul className="space-y-1 px-2">
                          {rows.map(row => {
                            const unassignedTeams = row.teams.filter(t => t.poolId === null).length;
                            const hasErrors = getRowErrors(row); 
                            
                            const hasAnyHostConflict = row.pools.some(p => {
                               const conf = getHostConflicts(p, row);
                               return conf.dateConflict || conf.prevConflict;
                            });

                            const poolSizeIssues = row.pools.length > 0 && row.teams.some(t => t.poolId !== null) ? (() => {
                              let hasSmallPool = false;
                              let hasLargePool = false;
                              row.pools.forEach(pool => {
                                const realCount = row.teams.filter(t => t.poolId === pool.id && !t.isBye).length;
                                if (realCount > 0 && realCount < 4) hasSmallPool = true;
                                if (realCount >= 8) hasLargePool = true;
                              });
                              return { hasSmallPool, hasLargePool };
                            })() : { hasSmallPool: false, hasLargePool: false };

                            return (
                              <li key={row.id}
                                  onDragOver={(e) => { e.preventDefault(); setDragOverSidebarRowId(row.id); }}
                                  onDragLeave={() => setDragOverSidebarRowId(null)}
                                  onDrop={(e) => handleSidebarRowDrop(e, row.id)}
                                  className={`rounded-lg border-2 transition-all group relative ${dragOverSidebarRowId === row.id ? 'border-blue-400 bg-blue-50' : 'border-transparent'}`}
                              >
                                <div onClick={() => setActiveRowId(row.id)} className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-150 text-xs pr-8 ${activeRowId === row.id ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-100'} ${hasActiveRowFilter && !hideFilteredRows && !filteredRowIds.has(row.id) ? 'opacity-30' : ''}`}>
                                  <span className="truncate flex items-center gap-2">
                                    <LayoutGrid className={`w-4 h-4 flex-shrink-0 ${activeRowId === row.id ? 'text-green-600' : 'text-gray-400'}`} />
                                    <span className="truncate">{row.name}</span>
                                  </span>
                                  <div className="flex items-center gap-1.5 flex-shrink-0 pl-2">
                                    {hasErrors && <AlertCircle className="w-4 h-4 text-red-500" title="Der er ubehandlede konflikter i en pulje" />}
                                    {hasAnyHostConflict && !hasErrors && <AlertTriangle className="w-4 h-4 text-orange-500" title="Der er en værtsklub-konflikt i en pulje" />}
                                    {row.hasWarning && !hasErrors && !hasAnyHostConflict && <AlertTriangle className="w-4 h-4 text-yellow-500" title="Ikke optimalt holdantal" />}
                                    {poolSizeIssues.hasSmallPool && <AlertTriangle className="w-4 h-4 text-purple-500" title="En pulje har færre end 4 hold — oversiddere tilføjes ved fordeling" />}
                                    {poolSizeIssues.hasLargePool && <AlertTriangle className="w-4 h-4 text-red-400" title="En pulje har 8+ hold — ideelt er 4-7 hold pr. pulje" />}
                                    {unassignedTeams > 0 && <span className="bg-orange-100 text-orange-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{unassignedTeams}</span>}
                                  </div>
                                </div>
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={(e) => { e.stopPropagation(); openEditRow(row); }} className="p-1 text-gray-400 hover:text-blue-600 rounded" title="Rediger række">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <div className="p-2.5 border-t border-gray-200 flex flex-col gap-1.5">
                  <button onClick={() => setAddManualRowPrompt(true)} className="w-full flex items-center justify-center gap-2 bg-gray-100 border border-gray-300 text-gray-700 py-1.5 rounded-lg hover:bg-gray-200 transition text-sm font-medium">
                    <Plus className="w-4 h-4 text-green-600" /> Tilføj række
                  </button>
                  <input type="file" accept=".xlsx, .xls, .csv, .txt" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 text-gray-700 py-1.5 rounded-lg hover:bg-gray-50 transition text-sm font-medium">
                    <Upload className="w-4 h-4 text-green-600" /> Importer rækker
                  </button>
                </div>
              </div>

              <div className={`w-1 cursor-col-resize z-20 flex-shrink-0 hover:bg-green-400 transition-colors ${isResizing ? 'bg-green-500' : 'bg-gray-200'}`} onMouseDown={() => setIsResizing(true)} title="Træk for at justere bredden på menuen" />

              <div className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="relative bg-white border-b border-gray-200 px-4 py-2 flex justify-between items-center shadow-sm z-10 flex-shrink-0">
                  <div className="flex-1 truncate pr-4">
                    <h2 className="text-base font-bold text-gray-800 flex items-center gap-2 truncate">{activeRow.name}</h2>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <button onClick={handleAutoFitAllColumns} className="flex items-center gap-1.5 bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded font-medium hover:bg-gray-200 transition-colors text-[11px] shadow-sm border border-gray-200" title="Auto-tilpas bredden på alle kolonner">
                      <MoveHorizontal className="w-3.5 h-3.5" /> Auto-tilpas
                    </button>
                    <button onClick={() => handleRandomizeClick('active')} className="flex items-center gap-1.5 bg-green-100 text-green-700 px-2.5 py-1.5 rounded font-medium hover:bg-green-200 transition-colors text-[11px] shadow-sm" title="Omfordel hold i denne række">
                      <Shuffle className="w-3.5 h-3.5" /> Fordel række
                    </button>
                    <button onClick={() => handleRandomizeClick('all')} className="flex items-center gap-1.5 bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded font-medium hover:bg-blue-200 transition-colors text-[11px] shadow-sm" title="Omfordel alle hold">
                      <Shuffle className="w-3.5 h-3.5" /> Fordel ALLE
                    </button>
                    <button onClick={() => setValidationModal({ isOpen: true, scope: 'all' })} className="flex items-center gap-1.5 bg-purple-100 text-purple-700 px-2.5 py-1.5 rounded font-medium hover:bg-purple-200 transition-colors text-[11px] shadow-sm" title="Validér fordelingen for alle rækker og puljer">
                      <ShieldCheck className="w-3.5 h-3.5" /> Validér
                    </button>
                    <button onClick={() => setGuideStep(1)} className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-400 text-white font-bold text-sm hover:bg-amber-500 transition-colors shadow-sm" title="Vis guide">?</button>
                  </div>
                  <div className="text-[11px] text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full font-medium">
                      Totalt: <span className="font-bold text-gray-800">{activeRow.teams.filter(t => !t.isBye).length}</span> hold
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col p-3 overflow-hidden">
                  {activeRow.hasWarning && (
                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2 rounded-lg mb-2 flex items-start gap-2 flex-shrink-0">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-sm">Bemærk: Antal hold ({activeRow.teams.filter(t => !t.isBye).length}) i rækken er ikke optimalt</h4>
                        <p className="text-xs mt-1">Det er matematisk umuligt at fordele {activeRow.teams.filter(t => !t.isBye).length} hold udelukkende i puljer af 4, 5 eller 6 hold. Mindst én pulje vil få 3 eller 7 hold.</p>
                      </div>
                    </div>
                  )}

                  {activeRow.pools.some(pool => {
                    const rc = activeRow.teams.filter(t => t.poolId === pool.id && !t.isBye).length;
                    return rc >= 8;
                  }) && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-2 flex items-start gap-2 flex-shrink-0">
                      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-sm">For mange hold i en pulje</h4>
                        <p className="text-xs mt-1">En eller flere puljer har 8+ hold. Ideelt antal er 4-7 hold pr. pulje. Overvej at oprette flere puljer eller flytte hold.</p>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 flex gap-3 overflow-x-auto overflow-y-hidden pb-2 items-start pr-4 relative">
                    {currentColumnOrder.map((colId, index) => {
                      if (colId === 'unassigned') {
                        const isDragOverHeader = dragOverHeaderPoolId === 'unassigned';
                        const isDragOver = dragOverPoolId === null; 
                        const isBeingResized = resizeStart.colId === 'unassigned';

                        return (
                          <div 
                            key="unassigned"
                            style={{ width: `${columnWidths['unassigned'] || 280}px` }}
                            className={`relative pool-container flex flex-col bg-white rounded-xl border-2 flex-shrink-0 max-h-full ${isBeingResized ? '' : 'transition-all duration-200'} ${
                              isDragOverHeader ? 'border-blue-500 bg-blue-50 shadow-lg -translate-y-1' : 
                              isDragOver && draggedTeamId !== null ? 'border-green-400 bg-green-50' : 'border-gray-200'
                            }`}
                          >
                            <div 
                              draggable
                              onDragStart={(e) => handlePoolDragStart(e, 'unassigned')}
                              onDragEnd={handlePoolDragEnd}
                              onDragOver={(e) => handlePoolDragOver(e, 'unassigned')}
                              onDrop={(e) => handlePoolDrop(e, 'unassigned')}
                              className={`p-4 border-b border-gray-100 bg-gray-50 rounded-t-xl flex justify-between items-center group cursor-grab active:cursor-grabbing transition-colors ${isDragOverHeader ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                            >
                              <h3 className="font-bold flex items-center gap-2 text-gray-700 truncate">
                                <GripVertical className="w-4 h-4 text-gray-400 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                <Users className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                <span className="truncate">Ikke-fordelte</span>
                              </h3>
                              <span className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded-full font-bold flex-shrink-0">{activeRow.teams.filter(t => t.poolId === null).length}</span>
                            </div>
                            
                            <div
                              className="flex-1 p-2 overflow-y-auto space-y-1"
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPoolId(null); }}
                              onDrop={(e) => handleTeamReorderDrop(e, null, null)}
                            >
                              {activeRow.teams.filter(t => t.poolId === null).map(team => {
                                const isRenamedBye = team.isBye && team.name !== 'Oversidder';
                                return (
                                  <div key={team.id}
                                       draggable
                                       onDragStart={(e) => handleDragStart(e, team.id)}
                                       onDragEnd={handleDragEnd}
                                       onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPoolId(null); }}
                                       onDrop={(e) => handleTeamReorderDrop(e, null, team.id)}
                                       className={`bg-white border p-2 rounded-lg shadow-sm cursor-grab active:cursor-grabbing transition-all group flex items-center gap-1.5 ${
                                          isRenamedBye ? 'bg-blue-50 border-blue-300 border-dashed text-blue-800 hover:border-blue-400' : 
                                          team.isBye ? 'bg-purple-50 border-purple-300 border-dashed text-purple-800 hover:border-purple-400' : 
                                          'border-gray-200 hover:border-green-400 hover:shadow-md'
                                       }`}>
                                    <GripVertical className={`w-4 h-4 flex-shrink-0 ${isRenamedBye ? 'text-blue-300 group-hover:text-blue-500' : team.isBye ? 'text-purple-300 group-hover:text-purple-500' : 'text-gray-300 group-hover:text-green-500'}`} />
                                    <div className="font-medium truncate text-sm flex-1">{team.name}</div>
                                    
                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => { setRenameTeamPrompt({ isOpen: true, teamId: team.id, currentName: team.name }); setNewTeamName(team.name !== 'Oversidder' ? team.name : ''); }} className={`p-1 ${isRenamedBye ? 'text-blue-400 hover:text-blue-600' : team.isBye ? 'text-purple-400 hover:text-purple-600' : 'text-gray-400 hover:text-gray-600'}`} title="Omdøb">
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      {isRenamedBye && (
                                        <button onClick={() => handleMakePermanent(team.id)} className="text-green-500 hover:text-green-700 p-1" title="Gør til permanent klub">
                                          <UserCheck className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button onClick={() => { setTransferTeamPrompt({ isOpen: true, teamId: team.id, teamName: team.name }); setSelectedTransferRow(data.find(r => r.id !== activeRowId)?.id || ""); }} className={`p-1 ${isRenamedBye ? 'text-blue-400 hover:text-blue-600' : team.isBye ? 'text-purple-400 hover:text-purple-600' : 'text-blue-400 hover:text-blue-600'}`} title="Flyt til anden række">
                                        <ChevronRight className="w-4 h-4" />
                                      </button>
                                      <button onClick={() => setDeleteTeamPrompt({ isOpen: true, teamId: team.id, teamName: team.name })} className={`p-1 ${isRenamedBye ? 'text-blue-400 hover:text-blue-600' : team.isBye ? 'text-purple-400 hover:text-purple-600' : 'text-red-400 hover:text-red-600'}`} title="Slet hold">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                              {activeRow.teams.filter(t => t.poolId === null).length === 0 && (
                                <div className="h-20 flex flex-col items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                                  <Trophy className="w-6 h-6 mb-1 opacity-50 text-green-500" /> <p>Alle hold er fordelt!</p>
                                </div>
                              )}
                            </div>

                            <div 
                              className={`absolute top-0 right-0 bottom-0 w-3 cursor-col-resize z-20 flex items-center justify-center group/resizer`}
                              onMouseDown={(e) => handleColResizeStart(e, 'unassigned')}
                              onDoubleClick={(e) => handleColAutoFit(e, 'unassigned')}
                              title="Træk for at justere. Dobbeltklik for auto-tilpasning."
                            >
                              <div className={`w-1 h-full transition-colors ${isBeingResized ? 'bg-green-500' : 'bg-transparent group-hover/resizer:bg-green-400'}`} />
                            </div>
                          </div>
                        );
                      }

                      const pool = activeRow.pools.find(p => p.id === colId);
                      if (!pool) return null;

                      const poolTeams = activeRow.teams.filter(t => t.poolId === pool.id);
                      const isOrganizerMode = (pool.hostMode || 'host') === 'organizer';
                      const hostTeam = isOrganizerMode ? null : poolTeams.find(t => t.isHost);
                      const regularTeams = isOrganizerMode ? poolTeams : poolTeams.filter(t => !t.isHost);

                      const isDragOver = dragOverPoolId === pool.id;
                      const isDragOverHost = dragOverHostPoolId === pool.id;
                      const isDragOverHeader = dragOverHeaderPoolId === pool.id;
                      const isBeingResized = resizeStart.colId === pool.id;
                      
                      const poolErrors = getPoolErrors(pool, activeRow.teams);
                      const unresolvedErrors = poolErrors.filter(e => !e.resolved);
                      const resolvedErrors = poolErrors.filter(e => e.resolved);
                      const hasUnresolvedError = unresolvedErrors.length > 0;
                      const hasSpecificRules = pool.specificCriteria?.useSpecific;

                      const rowIs3v3 = activeRow.name.includes('3:3');
                      const poolEffective3v3 = pool.formatOverride ? pool.formatOverride === '3:3' : rowIs3v3;
                      const poolMatrices = poolEffective3v3 ? fodaMatrices3v3 : fodaMatrices;
                      const poolDefaultTemplates = poolEffective3v3 ? defaultTemplates3v3 : defaultTemplates;
                      const availableTemplates = poolTeams.length >= 3 ? Object.keys(poolMatrices).filter(k => poolMatrices[k].size === poolTeams.length) : [];
                      const currentTemplate = (pool.templateKey && poolMatrices[pool.templateKey]?.size === poolTeams.length)
                          ? pool.templateKey
                          : poolDefaultTemplates[poolTeams.length];

                      const hostConflicts = getHostConflicts(pool, activeRow);
                      
                      let hostConflictDetails = [];
                      if (hostConflicts.dateConflict) {
                        data.forEach(r => {
                          const rDateMatch = r.name.match(/\d{1,2}\/\d{1,2}/);
                          const rDate = rDateMatch ? rDateMatch[0] : 'Andre';
                          if (rDate === hostConflicts.dateLabel) {
                            r.pools.forEach(p => {
                              if (r.id === activeRow.id && p.id === pool.id) return;
                              const pTeams = r.teams.filter(t => t.poolId === p.id);
                              const pHost = pTeams.find(t => t.isHost && !t.isBye);
                              if (pHost && pHost.club === hostConflicts.poolHost.club) {
                                hostConflictDetails.push({
                                  rowName: r.name,
                                  poolName: p.name,
                                  teams: pTeams.map(t => t.name)
                                });
                              }
                            });
                          }
                        });
                      }

                      const hasAnyHostConflict = hostConflicts.dateConflict || hostConflicts.prevConflict;

                      const poolWishes = getApplicableWishes(activeRow).filter(w => {
                         const isInPool = poolTeams.some(t => matchClubName(t.club, w.club));
                         return isInPool;
                      });

                      return (
                        <div
                          key={pool.id}
                          id={`pool-col-${pool.id}`}
                          style={{ width: `${columnWidths[pool.id] || 270}px` }}
                          className={`relative pool-container max-h-full flex flex-col rounded-xl border-2 shadow-sm flex-shrink-0 ${isBeingResized ? '' : 'transition-all duration-200'} ${isDragOver ? 'border-green-500 bg-green-50 scale-[1.02] shadow-lg' : isDragOverHeader ? 'border-blue-500 bg-blue-50 shadow-lg -translate-y-1' : (hasUnresolvedError || hasAnyHostConflict) ? 'border-red-400 bg-red-50/30' : hasSpecificRules ? 'border-blue-300 bg-blue-50/20' : 'border-gray-200 bg-gray-100'}`}
                        >
                          <div 
                            draggable
                            onDragStart={(e) => handlePoolDragStart(e, pool.id)}
                            onDragEnd={handlePoolDragEnd}
                            onDragOver={(e) => handlePoolDragOver(e, pool.id)}
                            onDrop={(e) => handlePoolDrop(e, pool.id)}
                            className={`p-2 border-b flex flex-col group rounded-t-xl cursor-grab active:cursor-grabbing transition-colors ${(hasUnresolvedError || hasAnyHostConflict) ? 'border-red-200 bg-red-50' : hasSpecificRules ? 'border-blue-200 bg-blue-50' : isDragOverHeader ? 'bg-blue-100' : 'border-gray-200 bg-gray-100 hover:bg-gray-200'}`}
                          >
                            {/* Linje 1: Puljenavn og Antal */}
                            <div className="flex justify-between items-center w-full mb-0.5">
                                <div className="flex items-center gap-2 overflow-hidden flex-1 pr-2">
                                  <GripVertical className="w-4 h-4 text-gray-400 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                                  <div className="flex items-center bg-white/50 border border-transparent hover:border-gray-300 focus-within:border-green-500 focus-within:bg-white rounded px-1 -ml-1 transition-all w-full">
                                    <Edit2 className="w-3 h-3 text-gray-400 mr-1 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                                    <input 
                                      value={pool.name}
                                      onChange={(e) => handleRenamePool(pool.id, e.target.value)}
                                      className="font-bold text-gray-800 bg-transparent w-full focus:outline-none py-0.5 truncate"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                {(() => {
                                  const realCount = poolTeams.filter(t => !t.isBye).length;
                                  const byeCount = poolTeams.length - realCount;
                                  const badgeColor = realCount >= 8 ? 'bg-red-100 text-red-700' : realCount > 0 && realCount < 4 ? 'bg-purple-100 text-purple-700' : (poolTeams.length === 3 || poolTeams.length === 7) ? 'bg-yellow-100 text-yellow-700' : 'bg-white text-gray-600';
                                  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm flex-shrink-0 ${badgeColor}`}>{byeCount > 0 ? `${realCount}+${byeCount}` : `${poolTeams.length}`} hold</span>;
                                })()}
                            </div>

                            {/* Starttidspunkt */}
                            <div className="text-[10px] text-gray-500 ml-5 font-medium flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {(() => {
                                const spec = pool.specificCriteria || {};
                                const time = spec.startTime || criteria.defaultPoolStartTime || '10:00';
                                return <span>{time}</span>;
                              })()}
                            </div>

                            {/* Linje 2: Menuknapper */}
                            <div className="flex items-center gap-1.5 w-full mb-1 ml-5 pr-4 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleResetKeys(pool.id)} className="flex items-center justify-center p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded" title="Opdater nøgler i puljen"><RefreshCw className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleAddBye(pool.id)} className="flex items-center justify-center p-1.5 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded" title="Tilføj Oversidder hold"><Coffee className="w-3.5 h-3.5" /></button>
                              <button onClick={() => openPoolSettings(pool)} className={`flex items-center justify-center p-1.5 rounded ${hasSpecificRules ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-600 bg-gray-200 hover:bg-gray-300'}`} title="Pulje Indstillinger"><Settings className="w-3.5 h-3.5" /></button>
                              {availableTemplates.length > 0 && (
                                 <button 
                                    onClick={() => setMatrixPreview({ isOpen: true, templateKey: currentTemplate })}
                                    className="flex items-center justify-center p-1.5 text-gray-600 bg-gray-200 hover:bg-gray-300 rounded"
                                    title="Vis matrix for skabelon"
                                 >
                                    <Grid className="w-3.5 h-3.5" />
                                 </button>
                              )}
                              <button onClick={() => confirmDeletePool(pool.id, pool.name, poolTeams.length)} className="flex items-center justify-center p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded" title="Slet pulje"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>

                            {/* Linje 3: Format-knap + Dropdown menu */}
                            {poolTeams.length >= 3 && (
                               <div className="flex items-center gap-1.5 w-full ml-5 pr-4" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => handlePoolFormatToggle(pool.id)}
                                    className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded border shadow-sm transition-colors ${poolEffective3v3 ? 'bg-orange-100 border-orange-300 text-orange-700 hover:bg-orange-200' : 'bg-indigo-100 border-indigo-300 text-indigo-700 hover:bg-indigo-200'} ${pool.formatOverride ? 'ring-2 ring-offset-1 ' + (poolEffective3v3 ? 'ring-orange-400' : 'ring-indigo-400') : ''}`}
                                    title={`Format: ${poolEffective3v3 ? '3:3' : '5:5'}${pool.formatOverride ? ' (overskrevet)' : ''} — Klik for at skifte`}
                                  >
                                    {poolEffective3v3 ? '3:3' : '5:5'}
                                  </button>
                                  {availableTemplates.length > 0 && (
                                  <select
                                    value={currentTemplate || ''}
                                    onChange={(e) => handleTemplateSelect(pool.id, e.target.value)}
                                    className="flex-1 text-[11px] font-medium text-gray-700 bg-white border border-gray-300 rounded px-1.5 py-1 shadow-sm hover:border-green-400 focus:outline-none focus:border-green-500 cursor-pointer truncate"
                                    title="Vælg skabelon for denne pulje"
                                  >
                                    {availableTemplates.map(tk => (
                                      <option key={tk} value={tk}>{tk}</option>
                                    ))}
                                  </select>
                                  )}
                               </div>
                            )}
                          </div>

                          {(poolWishes.length > 0 || hasAnyHostConflict || unresolvedErrors.length > 0 || resolvedErrors.length > 0) && (
                            <div className="flex flex-col">
                              {poolWishes.map((w, idx) => (
                                 <div key={`wish-${idx}`} className={`${w.ruleType === 'OBS' ? 'bg-purple-50 border-purple-200' : 'bg-pink-50 border-pink-200'} border-b px-3 py-2 text-[11px] font-medium flex flex-col gap-1.5 shadow-sm`}>
                                    <div className={`flex items-start gap-1.5 ${w.ruleType === 'OBS' ? 'text-purple-800' : 'text-pink-800'}`}>
                                       <Wand2 className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${w.ruleType === 'OBS' ? 'text-purple-500' : 'text-pink-500'}`} />
                                       <span className="leading-snug"><strong>{w.ruleType === 'OBS' ? 'OBS' : 'Regel'} ({w.club}):</strong> {w.text}</span>
                                    </div>
                                 </div>
                              ))}

                              {hostConflicts.dateConflict && (
                                 <div className={`bg-orange-100 px-3 py-2 text-[11px] font-medium border-b border-orange-200 flex flex-col gap-2 overflow-visible ${hostConflicts.hasForceHostOverride ? 'opacity-60 grayscale' : 'text-orange-800'}`}>
                                   <div className="flex justify-between items-start gap-2">
                                     <div className="flex items-start gap-1.5">
                                        <div className="relative group/icon cursor-help mt-0.5">
                                           <AlertTriangle className={`w-4 h-4 ${hostConflicts.hasForceHostOverride ? 'text-gray-500' : 'text-orange-600'}`} />
                                           <div className="absolute top-full left-0 mt-2 w-72 bg-gray-900 text-white p-3 rounded-lg shadow-xl opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-all z-[100] text-xs font-normal text-left pointer-events-none">
                                              <div className="font-bold text-orange-300 mb-2 pb-1 border-b border-gray-700">{hostConflicts.poolHost.club} er også vært i:</div>
                                              <ul className="space-y-2">
                                                {hostConflictDetails.map((c, idx) => (
                                                   <li key={idx}>
                                                     <div className="font-bold text-gray-100">{c.rowName} - {c.poolName}</div>
                                                     <div className="text-gray-400 mt-0.5 leading-tight break-words">{c.teams.join(', ')}</div>
                                                   </li>
                                                ))}
                                                {hostConflictDetails.length === 0 && <li className="text-gray-400 italic">Ingen data fundet</li>}
                                              </ul>
                                           </div>
                                        </div>
                                        <span className="leading-snug">
                                          <strong>Advarsel:</strong> {hostConflicts.poolHost.club} er vært i flere puljer! 
                                          {hostConflicts.hasForceHostOverride && <span className="text-pink-600 ml-1">(Ignoreret: Klubben har ønsket at være vært)</span>}
                                        </span>
                                     </div>
                                   </div>
                                   {!hostConflicts.hasForceHostOverride && (
                                     <div className="flex justify-end">
                                         <button onClick={() => setIgnoredHostConflicts([...ignoredHostConflicts, hostConflicts.ignoreDateKey])} className="bg-orange-200 hover:bg-orange-300 text-orange-900 px-2 py-1 rounded text-[10px] font-bold shadow-sm transition-colors border border-orange-300">
                                            Accepter konflikt
                                         </button>
                                     </div>
                                   )}
                                 </div>
                              )}

                              {hostConflicts.prevConflict && (
                                 <div className={`bg-orange-100 px-3 py-2 text-[11px] font-medium border-b border-orange-200 flex flex-col gap-2 overflow-visible ${hostConflicts.hasForceHostOverride ? 'opacity-60 grayscale' : 'text-orange-800'}`}>
                                   <div className="flex justify-between items-start gap-2">
                                     <div className="flex items-start gap-1.5">
                                        <div className="relative group/icon cursor-help mt-0.5">
                                           <AlertTriangle className={`w-4 h-4 ${hostConflicts.hasForceHostOverride ? 'text-gray-500' : 'text-orange-600'}`} />
                                           <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 text-white p-3 rounded-lg shadow-xl opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-all z-[100] text-xs font-normal text-left pointer-events-none">
                                              <div className="font-bold text-orange-300 mb-2 pb-1 border-b border-gray-700">Tidligere stævner for {hostConflicts.poolHost.club}:</div>
                                              <ul className="space-y-1">
                                                {hostConflicts.prevDates.length > 0 ? (
                                                   hostConflicts.prevDates.map((d, idx) => (
                                                      <li key={idx} className="flex items-center gap-2">
                                                         <div className="w-1.5 h-1.5 bg-orange-400 rounded-full flex-shrink-0"></div>
                                                         <span className="text-gray-100">{d}</span>
                                                      </li>
                                                   ))
                                                ) : (
                                                   <li className="text-gray-400 italic">Ukendt dato</li>
                                                )}
                                              </ul>
                                           </div>
                                        </div>
                                        <span className="leading-snug">
                                          <strong>Advarsel:</strong> {hostConflicts.poolHost.club} har tidligere afholdt stævne i denne række!
                                          {hostConflicts.hasForceHostOverride && <span className="text-pink-600 ml-1">(Ignoreret: Klubben har ønsket at være vært)</span>}
                                        </span>
                                     </div>
                                   </div>
                                   {!hostConflicts.hasForceHostOverride && (
                                     <div className="flex justify-end">
                                         <button onClick={() => setIgnoredPreviousHosts([...ignoredPreviousHosts, hostConflicts.ignorePrevKey])} className="bg-orange-200 hover:bg-orange-300 text-orange-900 px-2 py-1 rounded text-[10px] font-bold shadow-sm transition-colors border border-orange-300">
                                            Accepter konflikt
                                         </button>
                                     </div>
                                   )}
                                 </div>
                              )}
                              
                              {unresolvedErrors.length > 0 && (
                                <div className="bg-red-100 text-red-700 px-3 py-2 text-xs font-medium border-b border-red-200 flex flex-col gap-1">
                                  {unresolvedErrors.map((err, i) => (<div key={i} className="flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /><span>{err.message}</span></div>))}
                                  
                                  <div className="bg-white/60 p-2 rounded border border-red-200 text-red-800 flex flex-col items-start gap-1.5 mt-1">
                                    <div className="flex items-start gap-1.5">
                                      <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                      <span><strong>Anbefaling:</strong> Træk et af de berørte hold over i en anden pulje, eller sørg for at de har nøgler der ikke mødes.</span>
                                    </div>
                                    
                                    {unresolvedErrors.map(err => {
                                       if (err.clubs && err.clubs.length > 0) {
                                          const pair = findNonIntersectingPair(currentTemplate);
                                          if (pair) {
                                             return (
                                                <button 
                                                    key={err.clubs[0]} 
                                                    onClick={() => handleApplyConflictFix(pool.id, err.clubs[0], pair)} 
                                                    className="mt-1 w-full flex items-center justify-center gap-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 py-1.5 px-2 rounded-md border border-blue-300 transition-colors text-xs font-bold shadow-sm"
                                                >
                                                   <Wrench className="w-3 h-3" />
                                                   Løs automatisk: Giv holdene nøgle {pair[0]} & {pair[1]} (mødes ikke)
                                                </button>
                                             );
                                          }
                                       }
                                       return null;
                                    })}
                                  </div>
                                </div>
                              )}
                              
                              {resolvedErrors.length > 0 && (
                                <div className="bg-green-100 text-green-800 px-3 py-2 text-xs font-medium border-b border-green-200 flex flex-col gap-1">
                                  {resolvedErrors.map((err, i) => (
                                    <div key={i} className="flex items-start gap-1.5">
                                      <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                      <span><strong>Klubkonflikt for {err.clubs[0]} løst:</strong> Holdene har nu nøgler, hvor de ikke mødes.</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          
                          {isOrganizerMode ? (
                            <div className="p-2 border-b border-gray-200 bg-green-50/50">
                              <div className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> Arrangørklub
                                <button onClick={() => openHostModePopup(pool)} className="ml-1 p-0.5 rounded hover:bg-green-200 text-green-500 hover:text-green-700 transition-colors" title="Skift mellem Værtsklub og Arrangørklub">
                                  <Settings className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="border p-1.5 rounded-lg shadow-sm bg-green-100 border-green-300 text-green-900 flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-green-600 flex-shrink-0" />
                                <div className="font-semibold truncate text-sm flex-1">{pool.organizerClub || 'Ikke valgt'}</div>
                              </div>
                            </div>
                          ) : (
                          <div className={`p-2 border-b border-gray-200 transition-colors ${isDragOverHost ? 'bg-yellow-50 border-yellow-300' : (hasUnresolvedError || hasAnyHostConflict) ? 'bg-transparent' : 'bg-gray-50'}`} onDragOver={(e) => { e.preventDefault(); setDragOverHostPoolId(pool.id); setDragOverPoolId(null); }} onDrop={(e) => handleDropAsHost(e, pool.id)}>
                            <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> Værtsklub
                              <button onClick={() => openHostModePopup(pool)} className="ml-1 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="Skift mellem Værtsklub og Arrangørklub">
                                <Settings className="w-3 h-3" />
                              </button>
                            </div>
                            {hostTeam ? (
                              <div draggable onDragStart={(e) => handleDragStart(e, hostTeam.id)} onDragEnd={handleDragEnd} className={`border p-1.5 rounded-lg shadow-sm cursor-grab active:cursor-grabbing transition-all flex items-center gap-1.5 group ${hostTeam.isPinned ? 'border-l-[3px] border-l-blue-400 ' : ''}${hostTeam.isBye && hostTeam.name !== 'Oversidder' ? 'bg-blue-50 border-blue-300 border-dashed text-blue-900' : hostTeam.isBye ? 'bg-purple-100 border-purple-300 border-dashed text-purple-900' : 'bg-yellow-100 border-yellow-300 hover:border-yellow-400 text-yellow-900'}`} title="Træk holdet ned i puljen for at fjerne vært">
                                <GripVertical className={`w-4 h-4 flex-shrink-0 ${hostTeam.isBye && hostTeam.name !== 'Oversidder' ? 'text-blue-400/50' : hostTeam.isBye ? 'text-purple-400/50' : 'text-yellow-600/50'}`} />
                                {hostTeam.isPinned && <Lock className="w-3 h-3 text-blue-500 flex-shrink-0" />}
                                <div className="font-semibold truncate text-sm flex-1">{hostTeam.name}</div>
                                {/* Multi-pool host indikator — åbner sammenlignings-modal */}
                                {!hostTeam.isBye && allHostAssignments[hostTeam.club]?.length >= 2 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setMultiPoolCompare({ club: hostTeam.club }); }}
                                    className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
                                    title={`Sammenlign puljer — ${hostTeam.club} er vært for ${allHostAssignments[hostTeam.club].length} puljer`}
                                  >
                                    <Link className="w-3 h-3" />
                                    <span>{allHostAssignments[hostTeam.club].length}</span>
                                  </button>
                                )}
                                <div className="ml-auto flex items-center gap-0.5">
                                  <button onClick={() => handleTogglePin(hostTeam.id)} className={`${hostTeam.isPinned ? 'opacity-100 text-blue-500 hover:text-blue-700' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600'} transition-opacity p-1`} title={hostTeam.isPinned ? 'Fjern fiksering' : 'Fiksér hold (pulje + nøgle + rolle)'}>
                                    {hostTeam.isPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                  </button>
                                  <button onClick={() => { setRenameTeamPrompt({ isOpen: true, teamId: hostTeam.id, currentName: hostTeam.name }); setNewTeamName(hostTeam.name !== 'Oversidder' ? hostTeam.name : ''); }} className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 ${hostTeam.isBye && hostTeam.name !== 'Oversidder' ? 'text-blue-400 hover:text-blue-600' : hostTeam.isBye ? 'text-purple-400 hover:text-purple-600' : 'text-gray-400 hover:text-gray-600'}`} title="Omdøb">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  {(hostTeam.isBye && hostTeam.name !== 'Oversidder') && (
                                    <button onClick={() => handleMakePermanent(hostTeam.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-green-500 hover:text-green-700 p-1" title="Gør til permanent klub">
                                      <UserCheck className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <span
                                    draggable
                                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', `key:${hostTeam.id}`); }}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDrop={(e) => handleKeyDrop(e, hostTeam.id)}
                                    className={`cursor-grab active:cursor-grabbing flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded transition-transform hover:scale-110 ml-1 ${hostTeam.isBye && hostTeam.name !== 'Oversidder' ? 'bg-blue-200 text-blue-800' : hostTeam.isBye ? 'bg-purple-200 text-purple-800' : 'bg-yellow-200 text-yellow-800 hover:bg-yellow-300'}`}
                                    title="Træk her for at bytte Foda-nøgle med et andet hold"
                                  >
                                    <Key className="w-3 h-3" /> {hostTeam.fodaKey || 1}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="h-9 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-xs text-gray-400 bg-white/50">Træk værtsklub hertil</div>
                            )}
                          </div>
                          )}

                          <div className="flex-1 p-2 overflow-y-auto space-y-1" onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPoolId(pool.id); }} onDrop={(e) => handleTeamReorderDrop(e, pool.id, null)}>
                            {regularTeams.map((team) => {
                              const isRenamedBye = team.isBye && team.name !== 'Oversidder';
                              return (
                                <div key={team.id}
                                     draggable
                                     onDragStart={(e) => handleDragStart(e, team.id)}
                                     onDragEnd={handleDragEnd}
                                     onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPoolId(pool.id); }}
                                     onDrop={(e) => handleTeamReorderDrop(e, pool.id, team.id)}
                                     className={`bg-white border p-2 rounded-lg shadow-sm cursor-grab active:cursor-grabbing transition-all group flex items-center gap-1.5 ${team.isPinned ? 'border-l-[3px] border-l-blue-400 ' : ''}${
                                        isRenamedBye ? 'bg-blue-50 border-blue-300 border-dashed text-blue-800 hover:border-blue-400' :
                                        team.isBye ? 'bg-purple-50 border-purple-300 border-dashed text-purple-800 hover:border-purple-400' :
                                        hasUnresolvedError && unresolvedErrors.find(err => err.clubs.includes(team.club)) ? 'border-red-300 bg-red-50 hover:border-red-400' :
                                        'border-gray-200 hover:border-blue-400'
                                     }`}>
                                  <GripVertical className={`w-4 h-4 flex-shrink-0 ${isRenamedBye ? 'text-blue-300 group-hover:text-blue-500' : team.isBye ? 'text-purple-300 group-hover:text-purple-500' : 'text-gray-300'}`} />
                                  {team.isPinned && <Lock className="w-3 h-3 text-blue-500 flex-shrink-0" />}
                                  <div className="font-medium truncate text-sm flex-1">{team.name}</div>
                                  <div className="ml-auto flex items-center gap-0.5">
                                    <button onClick={() => handleTogglePin(team.id)} className={`${team.isPinned ? 'opacity-100 text-blue-500 hover:text-blue-700' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600'} transition-opacity p-1`} title={team.isPinned ? 'Fjern fiksering' : 'Fiksér hold (pulje + nøgle)'}>
                                      {team.isPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                    </button>
                                    <button onClick={() => { setRenameTeamPrompt({ isOpen: true, teamId: team.id, currentName: team.name }); setNewTeamName(team.name !== 'Oversidder' ? team.name : ''); }} className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 ${isRenamedBye ? 'text-blue-400 hover:text-blue-600' : team.isBye ? 'text-purple-400 hover:text-purple-600' : 'text-gray-400 hover:text-gray-600'}`} title="Omdøb">
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    {isRenamedBye && (
                                      <button onClick={() => handleMakePermanent(team.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-green-500 hover:text-green-700 p-1" title="Gør til permanent klub">
                                        <UserCheck className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <span 
                                      draggable
                                      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', `key:${team.id}`); }}
                                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                      onDrop={(e) => handleKeyDrop(e, team.id)}
                                      className={`cursor-grab active:cursor-grabbing flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded transition-transform hover:scale-110 ml-1 ${isRenamedBye ? 'bg-blue-200 text-blue-800' : team.isBye ? 'bg-purple-200 text-purple-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                      title="Træk her for at bytte Foda-nøgle med et andet hold"
                                    >
                                      <Key className="w-3 h-3" /> {team.fodaKey || '-'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                            {regularTeams.length === 0 && <div className="h-12 flex items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg bg-white/50">Træk hold herover</div>}
                          </div>

                          <div 
                            className={`absolute top-0 right-0 bottom-0 w-3 cursor-col-resize z-20 flex items-center justify-center group/resizer`}
                            onMouseDown={(e) => handleColResizeStart(e, pool.id)}
                            onDoubleClick={(e) => handleColAutoFit(e, pool.id)}
                            title="Træk for at justere. Dobbeltklik for auto-tilpasning."
                          >
                            <div className={`w-1 h-full transition-colors ${isBeingResized ? 'bg-green-500' : 'bg-transparent group-hover/resizer:bg-green-400'}`} />
                          </div>
                        </div>
                      );
                    })}

                    <button onClick={handleAddPool} className="min-w-[270px] w-[270px] flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-green-600 hover:border-green-400 hover:bg-green-50 transition-all gap-2 h-32 mt-0 flex-shrink-0">
                      <Plus className="w-6 h-6" /><span className="font-medium">Tilføj ny pulje</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* --- MODALER --- */}
        {addManualRowPrompt && (
           <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
                 <h3 className="text-xl font-bold text-gray-800 mb-2">Tilføj manuel række</h3>
                 <p className="text-gray-600 text-sm mb-6">Udfyld informationerne nedenfor for at oprette rækken.</p>
                 
                 <div className="space-y-4 mb-6">
                    <div className="flex gap-4">
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Årgang</label>
                          <input type="text" value={manualRowData.age} onChange={(e) => setManualRowData({...manualRowData, age: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none" placeholder="F.eks. U9"/>
                       </div>
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Køn</label>
                          <select value={manualRowData.gender} onChange={(e) => setManualRowData({...manualRowData, gender: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none bg-white">
                             <option value="Drenge">Drenge</option>
                             <option value="Piger">Piger</option>
                             <option value="Mix">Mix</option>
                          </select>
                       </div>
                    </div>

                    <div className="flex gap-4">
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Niveau</label>
                          <input type="text" value={manualRowData.level} onChange={(e) => setManualRowData({...manualRowData, level: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none" placeholder="F.eks. A, B, C"/>
                       </div>
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Format</label>
                          <input type="text" value={manualRowData.format} onChange={(e) => setManualRowData({...manualRowData, format: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none" placeholder="F.eks. 5:5, 3:3"/>
                       </div>
                    </div>

                    <div>
                       <label className="block text-xs font-bold text-gray-600 mb-1">Spilledato</label>
                       <input type="text" value={manualRowData.date} onChange={(e) => setManualRowData({...manualRowData, date: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none" placeholder="F.eks. 26/10"/>
                    </div>

                    <div>
                       <label className="block text-xs font-bold text-gray-600 mb-1">Antal hold fra start (kan være 0)</label>
                       <input type="number" min="0" value={manualRowData.initialTeams} onChange={(e) => setManualRowData({...manualRowData, initialTeams: parseInt(e.target.value) || 0})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-green-500 outline-none"/>
                    </div>
                 </div>

                 <div className="flex gap-3">
                    <button onClick={() => setAddManualRowPrompt(false)} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
                    <button onClick={executeAddManualRow} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 transition-colors shadow-sm">Opret række</button>
                 </div>
              </div>
           </div>
        )}

        {editRowPrompt && (
           <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
                 <h3 className="text-xl font-bold text-gray-800 mb-2">Rediger række</h3>
                 <p className="text-gray-600 text-sm mb-6">Ret informationerne for denne række.</p>
                 
                 <div className="space-y-4 mb-6">
                    <div className="flex gap-4">
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Årgang</label>
                          <input type="text" value={editRowData.age} onChange={(e) => setEditRowData({...editRowData, age: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="F.eks. U9"/>
                       </div>
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Køn</label>
                          <select value={editRowData.gender} onChange={(e) => setEditRowData({...editRowData, gender: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                             <option value="Drenge">Drenge</option>
                             <option value="Piger">Piger</option>
                             <option value="Mix">Mix</option>
                          </select>
                       </div>
                    </div>

                    <div className="flex gap-4">
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Niveau</label>
                          <input type="text" value={editRowData.level} onChange={(e) => setEditRowData({...editRowData, level: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="F.eks. A, B, C"/>
                       </div>
                       <div className="flex-1">
                          <label className="block text-xs font-bold text-gray-600 mb-1">Format</label>
                          <input type="text" value={editRowData.format} onChange={(e) => setEditRowData({...editRowData, format: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="F.eks. 5:5, 3:3"/>
                       </div>
                    </div>

                    <div>
                       <label className="block text-xs font-bold text-gray-600 mb-1">Spilledato</label>
                       <input type="text" value={editRowData.date} onChange={(e) => setEditRowData({...editRowData, date: e.target.value})} className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="F.eks. 26/10"/>
                    </div>
                 </div>

                 <div className="flex gap-3">
                    <button onClick={() => {setEditRowPrompt(false); setEditRowId(null);}} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
                    <button onClick={executeEditRow} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm">Gem ændringer</button>
                 </div>
              </div>
           </div>
        )}

        {/* Multi-pool sammenlignings-modal */}
        {multiPoolCompare && allHostAssignments[multiPoolCompare.club]?.length >= 2 && (() => {
          const club = multiPoolCompare.club;
          const assignments = allHostAssignments[club];

          // Hent hold for hver pulje + andre hold i rækken
          const poolColumns = assignments.map(a => {
            const row = data.find(r => r.id === a.rowId);
            if (!row) return null;
            const poolTeams = row.teams.filter(t => t.poolId === a.poolId);
            const host = poolTeams.find(t => t.isHost && !t.isBye);
            const regulars = poolTeams.filter(t => !t.isHost && !t.isBye);
            const byes = poolTeams.filter(t => t.isBye);
            const poolCount = poolTeams.filter(t => !t.isBye).length;
            // Andre hold i rækken (ikke i denne pulje, ikke byes, ikke host i andre puljer)
            const unassigned = row.teams.filter(t => t.poolId === null && !t.isBye);
            const inOtherPools = row.teams.filter(t => t.poolId !== null && t.poolId !== a.poolId && !t.isBye);
            const poolNameMap = {};
            row.pools.forEach(p => { poolNameMap[p.id] = p.name; });
            return { ...a, host, regulars, byes, allTeams: poolTeams, poolCount, unassigned, inOtherPools, poolNameMap };
          }).filter(Boolean);

          // Beregn fælles klubber (optræder i 2+ kolonner)
          const clubPresence = new Map();
          poolColumns.forEach((col, colIdx) => {
            const clubsInCol = new Set();
            col.allTeams.filter(t => !t.isBye).forEach(t => {
              clubsInCol.add(t.club);
            });
            clubsInCol.forEach(c => {
              if (!clubPresence.has(c)) clubPresence.set(c, new Set());
              clubPresence.get(c).add(colIdx);
            });
          });
          const sharedClubs = [...clubPresence.entries()]
            .filter(([c, cols]) => cols.size >= 2 && c !== club)
            .map(([c, cols]) => ({ club: c, count: cols.size }));

          // Farvepalette for fælles klubber
          const sharedColors = ['bg-emerald-50 border-l-emerald-400', 'bg-sky-50 border-l-sky-400', 'bg-violet-50 border-l-violet-400', 'bg-amber-50 border-l-amber-400', 'bg-rose-50 border-l-rose-400', 'bg-teal-50 border-l-teal-400'];
          const sharedColorMap = {};
          sharedClubs.forEach((sc, i) => { sharedColorMap[sc.club] = sharedColors[i % sharedColors.length]; });

          const sharedDotColors = ['bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-amber-400', 'bg-rose-400', 'bg-teal-400'];
          const sharedDotMap = {};
          sharedClubs.forEach((sc, i) => { sharedDotMap[sc.club] = sharedDotColors[i % sharedDotColors.length]; });

          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setMultiPoolCompare(null); setCompareExpandedCols(new Set()); }}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                      <Link className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">{club}</h3>
                      <p className="text-sm text-gray-500">Vært for {assignments.length} puljer — sammenlign hold på tværs</p>
                    </div>
                  </div>
                  <button onClick={() => { setMultiPoolCompare(null); setCompareExpandedCols(new Set()); }} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Kolonner */}
                <div className="flex-1 overflow-auto p-6">
                  <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${poolColumns.length}, minmax(200px, 1fr))` }}>
                    {poolColumns.map((col, colIdx) => (
                      <div key={`${col.rowId}-${col.poolId}`} className="flex flex-col">
                        {/* Kolonne-header */}
                        <div className="mb-3">
                          <button
                            onClick={() => { setActiveRowId(col.rowId); setMultiPoolCompare(null); setCompareExpandedCols(new Set()); }}
                            className="text-xs text-gray-500 hover:text-blue-600 transition-colors flex items-center gap-1 mb-1"
                            title="Gå til denne række"
                          >
                            {col.rowName} <ChevronRight className="w-3 h-3" />
                          </button>
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-gray-800">{col.poolName}</div>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${col.poolCount >= 8 ? 'bg-red-100 text-red-700' : col.poolCount >= 6 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                              {col.poolCount} hold
                            </span>
                          </div>
                        </div>

                        {/* Vært */}
                        {col.host && (
                          <div className={`border rounded-lg p-2.5 mb-2 flex items-center gap-2 ${col.host.isPinned ? 'border-l-[3px] border-l-blue-400 ' : ''}bg-yellow-50 border-yellow-300`}>
                            <MapPin className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />
                            <div className="font-semibold text-sm text-yellow-900 truncate flex-1">{col.host.name}</div>
                            <button
                              onClick={() => handleTogglePinForRow(col.rowId, col.host.id)}
                              className={`p-1 rounded transition-colors ${col.host.isPinned ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'}`}
                              title={col.host.isPinned ? 'Fjern fiksering' : 'Fiksér vært'}
                            >
                              {col.host.isPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        )}

                        {/* Øvrige hold */}
                        <div className="space-y-1.5">
                          {col.regulars.map(team => {
                            const isShared = sharedColorMap[team.club];
                            return (
                              <div key={team.id} className={`border border-gray-200 rounded-lg p-2 flex items-center gap-2 border-l-[3px] ${team.isPinned ? 'border-l-blue-400' : isShared ? isShared.split(' ')[1] || 'border-l-gray-200' : 'border-l-gray-200'} ${isShared ? isShared.split(' ')[0] : 'bg-white'}`}>
                                {sharedDotMap[team.club] && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sharedDotMap[team.club]}`} />}
                                <div className="text-sm text-gray-800 truncate flex-1">{team.name}</div>
                                <button
                                  onClick={() => moveTeamToPoolForRow(col.rowId, team.id, null)}
                                  className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"
                                  title="Fjern fra pulje"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleTogglePinForRow(col.rowId, team.id)}
                                  className={`p-1 rounded transition-colors ${team.isPinned ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'}`}
                                  title={team.isPinned ? 'Fjern fiksering' : 'Fiksér hold'}
                                >
                                  {team.isPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            );
                          })}
                          {col.byes.map(team => (
                            <div key={team.id} className="border border-dashed border-purple-300 rounded-lg p-2 flex items-center gap-2 bg-purple-50">
                              <Coffee className="w-3 h-3 text-purple-400 flex-shrink-0" />
                              <div className="text-sm text-purple-700 truncate flex-1">{team.name}</div>
                            </div>
                          ))}
                        </div>

                        {/* Andre hold i rækken */}
                        {(col.unassigned.length > 0 || col.inOtherPools.length > 0) && (() => {
                          const colKey = `${col.rowId}-${col.poolId}`;
                          const isExpanded = compareExpandedCols.has(colKey);
                          const totalOther = col.unassigned.length + col.inOtherPools.length;
                          return (
                            <div className="mt-3">
                              <button
                                onClick={() => {
                                  setCompareExpandedCols(prev => {
                                    const next = new Set(prev);
                                    if (next.has(colKey)) next.delete(colKey);
                                    else next.add(colKey);
                                    return next;
                                  });
                                }}
                                className="w-full flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors py-1.5"
                              >
                                <div className="flex-1 border-t border-dashed border-gray-200" />
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                <span>Andre hold ({totalOther})</span>
                                <div className="flex-1 border-t border-dashed border-gray-200" />
                              </button>
                              {isExpanded && (
                                <div className="space-y-1 mt-1">
                                  {col.unassigned.length > 0 && (
                                    <>
                                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider px-1">Ufordelte</div>
                                      {col.unassigned.map(team => {
                                        const isShared = sharedColorMap[team.club];
                                        return (
                                          <div key={team.id} className={`border border-dashed border-gray-200 rounded-lg p-1.5 flex items-center gap-2 ${isShared ? isShared.split(' ')[0] : 'bg-gray-50'}`}>
                                            {sharedDotMap[team.club] && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sharedDotMap[team.club]}`} />}
                                            <div className="text-xs text-gray-600 truncate flex-1">{team.name}</div>
                                            <button
                                              onClick={() => moveTeamToPoolForRow(col.rowId, team.id, col.poolId)}
                                              className="p-1 rounded text-green-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                                              title="Tilføj til pulje"
                                            >
                                              <Plus className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                  {col.inOtherPools.length > 0 && (
                                    <>
                                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider px-1 mt-2">Fra andre puljer</div>
                                      {col.inOtherPools.map(team => {
                                        const isShared = sharedColorMap[team.club];
                                        const fromPoolName = col.poolNameMap[team.poolId] || 'Ukendt pulje';
                                        return (
                                          <div key={team.id} className={`border border-dashed border-orange-200 rounded-lg p-1.5 flex items-center gap-2 ${isShared ? isShared.split(' ')[0] : 'bg-orange-50/50'}`}>
                                            {sharedDotMap[team.club] && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sharedDotMap[team.club]}`} />}
                                            <div className="flex-1 min-w-0">
                                              <div className="text-xs text-gray-600 truncate">{team.name}</div>
                                              <div className="text-[10px] text-orange-500 truncate">{fromPoolName}</div>
                                            </div>
                                            <button
                                              onClick={() => moveTeamToPoolForRow(col.rowId, team.id, col.poolId)}
                                              className="p-1 rounded text-orange-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                                              title={`Flyt fra ${fromPoolName} til denne pulje`}
                                            >
                                              <Plus className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>

                  {/* Fælles klubber oversigt */}
                  {sharedClubs.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-gray-200">
                      <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <Users className="w-4 h-4 text-green-600" />
                        Fælles klubber på tværs af puljerne
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {sharedClubs.map(sc => (
                          <span key={sc.club} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-700`}>
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sharedDotMap[sc.club]}`} />
                            {sc.club}
                            <span className="text-gray-400">({sc.count}/{poolColumns.length})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {matrixPreview.isOpen && matrixPreview.templateKey && (fodaMatrices[matrixPreview.templateKey] || fodaMatrices3v3[matrixPreview.templateKey]) && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setMatrixPreview({isOpen: false, templateKey: null})}>
            {(() => {
              const tData = fodaMatrices[matrixPreview.templateKey] || fodaMatrices3v3[matrixPreview.templateKey];
              const m = tData.matrix;
              const s = tData.size;
              const allMeet = isAllMeetAll(m);

              // Compute dobbelt pairs for popup
              const popupDobbeltPairs = [];
              let popupTotalPairs = 0;
              for (let pi = 0; pi < m.length; pi++) {
                for (let pj = pi + 1; pj < m[pi].length; pj++) {
                  popupTotalPairs++;
                  if (m[pi][pj] >= 2) popupDobbeltPairs.push({ a: pi + 1, b: pj + 1, count: m[pi][pj] });
                }
              }
              const hasPartialDobbelt = popupDobbeltPairs.length > 0 && popupDobbeltPairs.length < popupTotalPairs;

              // Group by key for dobbelt display
              const popupMeetMultiple = {};
              if (hasPartialDobbelt) {
                popupDobbeltPairs.forEach(({ a, b, count }) => {
                  if (!popupMeetMultiple[a]) popupMeetMultiple[a] = [];
                  popupMeetMultiple[a].push({ key: b, count });
                  if (!popupMeetMultiple[b]) popupMeetMultiple[b] = [];
                  popupMeetMultiple[b].push({ key: a, count });
                });
              }

              // Compute last opponents for popup
              const popupLastOpp = getLastOpponents(matrixPreview.templateKey, m, predefinedSchedules);

              return (
                <div className="bg-white rounded-xl p-6 max-w-4xl w-full shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                   <div className="flex justify-between items-center mb-6 border-b pb-4">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Grid className="w-6 h-6 text-green-600" /> Oversigt: {matrixPreview.templateKey}</h3>
                        <button onClick={() => {
                          const is3v3Template = !!fodaMatrices3v3[matrixPreview.templateKey];
                          if (is3v3Template) { setSelectedFodaTemplate3v3(matrixPreview.templateKey); } else { setSelectedFodaTemplate(matrixPreview.templateKey); }
                          setMatrixPreview({isOpen: false, templateKey: null});
                          setActiveTab('nøgler');
                        }} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors font-medium" title="Gå til skabelonen i Nøgler-fanen">
                          <Key className="w-3.5 h-3.5" /> Gå til skabelon
                        </button>
                      </div>
                      <button onClick={() => setMatrixPreview({isOpen: false, templateKey: null})} className="text-gray-400 hover:text-gray-600 p-1 bg-gray-100 rounded-full hover:bg-gray-200"><X className="w-5 h-5" /></button>
                   </div>
                   <div className="flex-1 overflow-y-auto">
                     {allMeet ? (
                       <div>
                         <div className="flex items-center justify-center py-8">
                           <div className="text-center">
                             <Check className="w-16 h-16 text-green-500 mx-auto mb-3" />
                             <h4 className="font-bold text-green-800 text-lg mb-2">Alle hold møder alle andre hold</h4>
                             <p className="text-green-700 text-sm max-w-md mx-auto">I denne skabelon møder hvert hold alle andre hold. Der er ingen nøglekonflikter mulige, og matrixen er derfor ikke nødvendig at vise.</p>
                           </div>
                         </div>
                         {Object.keys(popupLastOpp).length > 0 && (
                           <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 mt-2 mb-2">
                             <h4 className="font-bold text-gray-700 mb-3">Sidste kamp for hver nøgle</h4>
                             <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                               {Array.from({ length: s }).map((_, i) => (
                                 <div key={i} className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm flex items-center gap-2">
                                   <span className="font-bold text-gray-700 text-lg">{i + 1}</span>
                                   <span className="text-sm text-gray-500">→ mod {popupLastOpp[i + 1] || '?'}</span>
                                 </div>
                               ))}
                             </div>
                           </div>
                         )}
                       </div>
                     ) : (
                       <div className="overflow-x-auto mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                         <table className="w-full text-center border-collapse bg-white">
                            <thead>
                              <tr>
                                <th className="p-3 bg-gray-100 border border-gray-200 text-gray-600 font-bold whitespace-nowrap rounded-tl-lg">Nøgle \ Nøgle</th>
                                {Array.from({length: s}).map((_, i) => (
                                  <th key={i} className={`p-3 bg-gray-100 border border-gray-200 text-gray-800 font-bold whitespace-nowrap ${i === s-1 ? 'rounded-tr-lg' : ''}`}>Nøgle {i + 1}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {m.map((row, i) => (
                                <tr key={i}>
                                  <td className={`p-3 bg-gray-100 border border-gray-200 font-bold text-gray-800 text-left pl-4 whitespace-nowrap ${i === s-1 ? 'rounded-bl-lg' : ''}`}>Nøgle {i + 1}</td>
                                  {row.map((val, j) => {
                                    if (i === j) return <td key={j} className={`p-3 border border-gray-200 bg-gray-200/50 ${i === s-1 && j === s-1 ? 'rounded-br-lg' : ''}`}></td>;
                                    if (val >= 1) return <td key={j} className="p-3 border border-gray-200 bg-green-50 text-green-600"><Check className="w-5 h-5 mx-auto" /></td>;
                                    return <td key={j} className="p-3 border border-gray-200 bg-red-50 text-red-500 font-bold"><X className="w-5 h-5 mx-auto" /></td>;
                                  })}
                                </tr>
                              ))}
                            </tbody>
                         </table>
                       </div>
                     )}

                     {/* Show last opponent for each key */}
                     {Object.keys(popupLastOpp).length > 0 && !allMeet && (
                       <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 mt-4 mb-2">
                         <h4 className="font-bold text-gray-700 mb-3">Sidste kamp for hver nøgle</h4>
                         <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                           {Array.from({ length: s }).map((_, i) => (
                             <div key={i} className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm flex items-center gap-2">
                               <span className="font-bold text-gray-700 text-lg">{i + 1}</span>
                               <span className="text-sm text-gray-500">→ mod {popupLastOpp[i + 1] || '?'}</span>
                             </div>
                           ))}
                         </div>
                       </div>
                     )}

                     {/* Show dobbelt overview in popup when relevant */}
                     {hasPartialDobbelt && (
                       <div className="bg-amber-50 p-5 rounded-xl border border-amber-200 mt-4 mb-2">
                         <h4 className="font-bold text-amber-800 mb-2 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Hvem møder hinanden 2+ gange?</h4>
                         <p className="text-amber-700 text-sm mb-3">Disse nøgler møder hinanden mere end én gang i skabelonen.</p>
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                           {Array.from({ length: s }).map((_, i) => {
                             const partners = popupMeetMultiple[i + 1] || [];
                             if (partners.length === 0) return null;
                             return (
                               <div key={i} className="bg-white p-3 rounded-lg border border-amber-200 shadow-sm">
                                 <div className="font-bold text-gray-700 mb-1 text-lg">{i + 1}</div>
                                 <div className="text-sm text-amber-700 flex items-center gap-1.5">
                                   <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Møder {partners.map(p => `${p.key} (${p.count}x)`).join(', ')}
                                 </div>
                                 {popupLastOpp[i + 1] && (
                                   <div className="text-xs text-gray-500 mt-1">Sidste kamp: mod {popupLastOpp[i + 1]}</div>
                                 )}
                               </div>
                             );
                           })}
                         </div>
                       </div>
                     )}
                   </div>
                   <button onClick={() => setMatrixPreview({isOpen: false, templateKey: null})} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition-colors shadow-sm mt-4">Forstået, luk oversigt</button>
                </div>
              );
            })()}
          </div>
        )}

        {templatePrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Skift skabelon</h3>
              <p className="text-gray-600 mb-6">
                Du har valgt skabelonen <strong>{templatePrompt.templateKey}</strong>.
                <br/><br/>
                Vil du gennemtvinge en opdatering af holdenes nøgler med det samme, eller vil du blot gemme valget til næste gang nøglerne alligevel skal genberegnes?
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={() => confirmTemplateChange(true)} className="w-full bg-blue-50 text-blue-700 border border-blue-200 py-2.5 rounded-lg font-medium hover:bg-blue-100 transition-colors flex justify-center items-center gap-2">
                   <RefreshCw className="w-4 h-4" /> Opdater nøgler i puljen nu
                </button>
                <button onClick={() => confirmTemplateChange(false)} className="w-full bg-gray-50 text-gray-700 border border-gray-200 py-2.5 rounded-lg font-medium hover:bg-gray-100 transition-colors">
                   Kun gem valg (behold nuværende nøgler)
                </button>
                <button onClick={() => setTemplatePrompt({ isOpen: false, poolId: null, templateKey: null })} className="w-full mt-2 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">
                   Annuller skift
                </button>
              </div>
            </div>
          </div>
        )}

        {createPoolsPrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Mangler puljer</h3>
              <p className="text-gray-600 mb-6">
                Du har ikke oprettet nogle puljer endnu. Ud fra rækkens antal hold foreslår vi at oprette <strong>{getOptimalPoolConfig(activeRow.teams.filter(t => !t.isBye).length).poolCount}</strong> puljer.
                <br/><br/>
                Hvor mange puljer vil du oprette?
              </p>
              
              <div className="flex items-center justify-center gap-6 mb-8 bg-gray-50 py-4 rounded-xl border border-gray-200">
                <button onClick={() => setCreatePoolsPrompt(p => ({...p, count: Math.max(1, p.count - 1)}))} className="w-12 h-12 rounded-full bg-white border border-gray-300 shadow-sm flex items-center justify-center hover:bg-gray-100 hover:border-gray-400 font-bold text-2xl transition-all">-</button>
                <span className="text-4xl font-bold text-gray-800 w-16 text-center">{createPoolsPrompt.count}</span>
                <button onClick={() => setCreatePoolsPrompt(p => ({...p, count: p.count + 1}))} className="w-12 h-12 rounded-full bg-white border border-gray-300 shadow-sm flex items-center justify-center hover:bg-gray-100 hover:border-gray-400 font-bold text-2xl transition-all">+</button>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setCreatePoolsPrompt({ isOpen: false, count: 1, scope: null })} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
                <button onClick={handleCreatePoolsAndRandomize} className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors shadow-sm">Opret og Fordel</button>
              </div>
            </div>
          </div>
        )}

        {deletePrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Slet {deletePrompt.poolName}?</h3>
              <p className="text-gray-600 mb-6">Der er <strong>{deletePrompt.teamCount} hold</strong> i denne pulje. Hvad skal der ske med dem?</p>
              <div className="flex flex-col gap-3">
                {activeRow.pools.length > 1 && (
                  <button onClick={() => executeDeletePool('distribute')} className="w-full bg-blue-50 text-blue-700 border border-blue-200 py-2.5 rounded-lg font-medium hover:bg-blue-100 transition-colors">Fordel holdene tilfældigt i de ANDRE puljer</button>
                )}
                <button onClick={() => executeDeletePool('unassigned')} className="w-full bg-orange-50 text-orange-700 border border-orange-200 py-2.5 rounded-lg font-medium hover:bg-orange-100 transition-colors">Flyt holdene tilbage til "Ikke-fordelte"</button>
                <button onClick={() => setDeletePrompt({ isOpen: false, poolId: null, poolName: '', teamCount: 0 })} className="w-full mt-2 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
              </div>
            </div>
          </div>
        )}

        {deleteTeamPrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Slet hold?</h3>
              <p className="text-gray-600 mb-6">Er du sikker på, at du vil slette <strong>{deleteTeamPrompt.teamName}</strong> helt fra denne række?</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTeamPrompt({ isOpen: false, teamId: null, teamName: '' })} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Fortryd</button>
                <button onClick={() => { handleDeleteTeam(deleteTeamPrompt.teamId); setDeleteTeamPrompt({ isOpen: false, teamId: null, teamName: '' }); }} className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm">Slet</button>
              </div>
            </div>
          </div>
        )}

        {reshufflePrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2"><Shuffle className="w-6 h-6 text-blue-600" /> Omfordeling af hold</h3>
              <p className="text-gray-600 mb-6">Der er allerede hold placeret i {reshufflePrompt.scope === 'active' ? 'denne rækkes' : 'rækkernes'} puljer. Vil du beholde dem, eller skal rækken nulstilles og alle hold blandes forfra?</p>
              <div className="flex flex-col gap-3">
                <button onClick={() => { const s = reshufflePrompt.scope; setReshufflePrompt({ isOpen: false, scope: null }); executeRandomizeWithRetry('all', s); }} className="w-full bg-red-50 text-red-700 border border-red-200 py-2.5 rounded-lg font-medium hover:bg-red-100 transition-colors flex justify-center items-center gap-2">Nulstil og omfordel ALLE hold</button>
                <button onClick={() => { const s = reshufflePrompt.scope; setReshufflePrompt({ isOpen: false, scope: null }); executeRandomizeWithRetry('unassigned', s); }} className="w-full bg-blue-50 text-blue-700 border border-blue-200 py-2.5 rounded-lg font-medium hover:bg-blue-100 transition-colors flex justify-center items-center gap-2">Fordel KUN ikke-fordelte hold</button>
                <button onClick={() => setReshufflePrompt({ isOpen: false, scope: null })} className="w-full mt-2 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
              </div>
            </div>
          </div>
        )}

        {poolSettingsPrompt.isOpen && (() => {
          const editingPool = activeRow?.pools.find(p => p.id === poolSettingsPrompt.poolId);
          const isEditingOrgPool = editingPool && (editingPool.hostMode || 'host') === 'organizer';
          return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2"><Settings className="w-6 h-6 text-gray-600" /> Indstillinger: {poolSettingsPrompt.poolName}</h3>
              <p className="text-sm text-gray-500 mb-6 pb-4 border-b">Her kan lade denne specifikke pulje overtrumfe de generelle kriterier.</p>

              <div className="space-y-4 mb-8">
                <label className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer">
                  <span className="font-semibold text-blue-900">Brug specifikke kriterier</span>
                  <input type="checkbox" className="w-5 h-5 accent-blue-600" checked={poolSettingsPrompt.criteria.useSpecific} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, useSpecific: e.target.checked } }))} />
                </label>

                <div className={`space-y-3 pl-2 transition-opacity duration-200 ${poolSettingsPrompt.criteria.useSpecific ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.avoidSameClub} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, avoidSameClub: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><Shield className="w-4 h-4 text-blue-500" /> Ingen hold fra samme klub</span>
                  </label>
                  {!isEditingOrgPool && (<>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.autoAssignHost} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, autoAssignHost: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><UserCheck className="w-4 h-4 text-purple-500" /> Udvælg automatisk Værtsklub i denne</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.hostGetsMostMatches} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, hostGetsMostMatches: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><Key className="w-4 h-4 text-amber-500" /> Værtsklub skal have flest kampe</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.avoidMultipleHostsOnSameDate ?? true} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, avoidMultipleHostsOnSameDate: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><Calendar className="w-4 h-4 text-rose-500" /> Undgå samme vært flere gange på samme dato</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.avoidPreviousHosts ?? true} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, avoidPreviousHosts: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><History className="w-4 h-4 text-teal-500" /> Undgå at vælge tidligere værtsklubber</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.avoidInsufficientBaneCapacity ?? true} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, avoidInsufficientBaneCapacity: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><Shield className="w-4 h-4 text-red-500" /> Undgå vært uden nok baner</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.prioritizeNewHostInAgeGroup ?? true} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, prioritizeNewHostInAgeGroup: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><Star className="w-4 h-4 text-yellow-500" /> Prioriter ny vært i årgangen</span>
                  </label>
                  </>)}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.checkBaneCapacity ?? true} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, checkBaneCapacity: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><Grid className="w-4 h-4 text-orange-500" /> Tjek banekapacitet</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-green-600" checked={poolSettingsPrompt.criteria.preferGeographicProximity ?? true} onChange={(e) => setPoolSettingsPrompt(prev => ({ ...prev, criteria: { ...prev.criteria, preferGeographicProximity: e.target.checked } }))} />
                    <span className="text-gray-700 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-green-500" /> Geografisk nærhed</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3 mb-6 pt-4 border-t border-gray-100">
                <Clock className="w-4 h-4 text-blue-500" />
                <label className="text-sm text-gray-700 font-medium">Starttidspunkt:</label>
                <input type="time"
                  value={poolSettingsPrompt.criteria.startTime || criteria.defaultPoolStartTime || '10:00'}
                  onChange={(e) => setPoolSettingsPrompt(prev => ({
                    ...prev, criteria: { ...prev.criteria, startTime: e.target.value }
                  }))}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm font-medium" />
                {poolSettingsPrompt.criteria.startTime && (
                  <button onClick={() => setPoolSettingsPrompt(prev => ({
                    ...prev, criteria: { ...prev.criteria, startTime: null }
                  }))} className="text-xs text-gray-400 hover:text-gray-600 underline">
                    Nulstil
                  </button>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setPoolSettingsPrompt({ isOpen: false, poolId: null, poolName: '', criteria: null })} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
                <button onClick={savePoolSettings} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 transition-colors shadow-sm">Gem indstillinger</button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Værtskabstype popup (Værtsklub / Arrangørklub) */}
        {hostModePopup.isOpen && (() => {
          const uniqueClubsForPopup = activeRow
            ? [...new Set([
                ...activeRow.teams.filter(t => !t.isBye).map(t => t.club),
                ...clubs.map(c => c.name)
              ])].filter(Boolean).sort()
            : [];
          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setHostModePopup({ isOpen: false, poolId: null, poolName: '', currentMode: 'host', organizerClub: null }); }}>
              <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl">
                <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-gray-600" />
                  Værtskabstype: {hostModePopup.poolName}
                </h3>
                <p className="text-sm text-gray-500 mb-5 pb-3 border-b">
                  Vælg om puljen skal have en værtsklub (et hold i puljen) eller en arrangørklub (ekstern klub, spiller ikke med).
                </p>

                <div className="space-y-3 mb-6">
                  <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${hostModePopup.currentMode === 'host' ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="hostMode" value="host" checked={hostModePopup.currentMode === 'host'}
                      onChange={() => setHostModePopup(prev => ({ ...prev, currentMode: 'host', organizerClub: null }))}
                      className="accent-yellow-500 w-4 h-4" />
                    <div>
                      <div className="font-semibold text-gray-800">Værtsklub</div>
                      <div className="text-xs text-gray-500">Et hold i puljen er vært og spiller med</div>
                    </div>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${hostModePopup.currentMode === 'organizer' ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="hostMode" value="organizer" checked={hostModePopup.currentMode === 'organizer'}
                      onChange={() => setHostModePopup(prev => ({ ...prev, currentMode: 'organizer' }))}
                      className="accent-green-500 w-4 h-4" />
                    <div>
                      <div className="font-semibold text-gray-800">Arrangørklub</div>
                      <div className="text-xs text-gray-500">Ekstern klub stiller baner til rådighed (spiller ikke med)</div>
                    </div>
                  </label>
                </div>

                {hostModePopup.currentMode === 'organizer' && (
                  <div className="mb-6">
                    <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Vælg arrangørklub</label>
                    <select
                      value={hostModePopup.organizerClub || ''}
                      onChange={(e) => setHostModePopup(prev => ({ ...prev, organizerClub: e.target.value || null }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm"
                    >
                      <option value="">-- Vælg klub --</option>
                      {uniqueClubsForPopup.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setHostModePopup({ isOpen: false, poolId: null, poolName: '', currentMode: 'host', organizerClub: null })}
                    className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">
                    Annuller
                  </button>
                  <button onClick={saveHostMode}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-colors shadow-sm ${hostModePopup.currentMode === 'organizer' && !hostModePopup.organizerClub ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                    disabled={hostModePopup.currentMode === 'organizer' && !hostModePopup.organizerClub}>
                    Gem
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Filter-dialog for rækker */}
        {rowFilterOpen && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setRowFilterOpen(false); }}>
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
                <Filter className="w-5 h-5 text-blue-600" />
                Filtrér Rækker
              </h3>
              <p className="text-gray-500 text-xs mb-5">
                {hasActiveRowFilter ? `Viser ${filteredRowIds.size} af ${data.length} rækker` : `${data.length} rækker i alt`}
              </p>

              <div className="space-y-4">
                {rowFilterOptions.årgange.length > 1 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Årgang</label>
                    <select value={rowFilterArgang} onChange={e => setRowFilterArgang(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white text-sm">
                      <option value="ALL">Alle årgange</option>
                      {rowFilterOptions.årgange.map(å => <option key={å} value={å}>{å}</option>)}
                    </select>
                  </div>
                )}

                {rowFilterOptions.niveauer.length > 1 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Niveau</label>
                    <select value={rowFilterNiveau} onChange={e => setRowFilterNiveau(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white text-sm">
                      <option value="ALL">Alle niveauer</option>
                      {rowFilterOptions.niveauer.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}

                {rowFilterOptions.køn.length > 1 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Køn</label>
                    <select value={rowFilterKoen} onChange={e => setRowFilterKoen(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white text-sm">
                      <option value="ALL">Alle køn</option>
                      {rowFilterOptions.køn.map(k => <option key={k} value={k}>{k === 'dr.' ? 'Drenge' : k === 'pi.' ? 'Piger' : k === 'mix' ? 'Mix' : k}</option>)}
                    </select>
                  </div>
                )}

                {rowFilterOptions.formater.length > 1 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Format</label>
                    <select value={rowFilterFormat} onChange={e => setRowFilterFormat(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white text-sm">
                      <option value="ALL">Alle formater</option>
                      {rowFilterOptions.formater.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                )}

                {rowFilterOptions.datoer.length > 1 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Spilledato</label>
                    <select value={rowFilterDato} onChange={e => setRowFilterDato(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white text-sm">
                      <option value="ALL">Alle datoer</option>
                      {rowFilterOptions.datoer.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 mt-5 pt-4 border-t border-gray-100 cursor-pointer">
                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${hideFilteredRows ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  {hideFilteredRows && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
                <span className="text-sm text-gray-700 font-medium">Skjul rækker der ikke matcher</span>
                <span className="text-[10px] text-gray-400 ml-auto">(også i PDF)</span>
                <input type="checkbox" className="hidden" checked={hideFilteredRows} onChange={e => setHideFilteredRows(e.target.checked)} />
              </label>

              <div className="flex gap-3 mt-5">
                {hasActiveRowFilter && (
                  <button onClick={() => { setRowFilterArgang('ALL'); setRowFilterNiveau('ALL'); setRowFilterKoen('ALL'); setRowFilterFormat('ALL'); setRowFilterDato('ALL'); }}
                    className="flex-1 bg-red-50 text-red-600 py-2.5 rounded-lg font-medium hover:bg-red-100 transition-colors text-sm">
                    Nulstil filtre
                  </button>
                )}
                <button onClick={() => setRowFilterOpen(false)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors text-sm">
                  Luk
                </button>
              </div>
            </div>
          </div>
        )}

        {infoModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl text-center">
              <Info className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-800 mb-2">{infoModal.title}</h3>
              <p className="text-gray-600 mb-6">{infoModal.message}</p>
              <button onClick={() => setInfoModal({ isOpen: false, title: '', message: '' })} className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Forstået</button>
            </div>
          </div>
        )}

        {showTransferPrompt && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Bekræft overførsel</h3>
              <p className="text-gray-600 mb-6">
                Er du sikker på, at du vil overføre alle værtsklubber fra det nuværende stævne til historikken? 
                Dataene vil blive lagt sammen med de eksisterende tidligere stævner.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowTransferPrompt(false)} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Fortryd</button>
                <button onClick={() => { handleTransferToPrevious(); setShowTransferPrompt(false); }} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm">Ok</button>
              </div>
            </div>
          </div>
        )}

        {transferTeamPrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Flyt hold til anden række</h3>
              <p className="text-gray-600 mb-4">Vælg hvilken række du vil flytte <strong>{transferTeamPrompt.teamName}</strong> til.</p>
              
              <select 
                value={selectedTransferRow} 
                onChange={e => setSelectedTransferRow(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 mb-6 focus:ring-2 focus:ring-green-500 outline-none cursor-pointer"
              >
                {data.filter(r => r.id !== activeRowId).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>

              <div className="flex gap-3">
                <button onClick={() => setTransferTeamPrompt({isOpen: false, teamId: null, teamName: ''})} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
                <button onClick={() => executeTransferTeam(selectedTransferRow)} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm" disabled={!selectedTransferRow}>Flyt Hold</button>
              </div>
            </div>
          </div>
        )}

        {renameTeamPrompt.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Omdøb hold</h3>
              <p className="text-gray-600 mb-4">Angiv et nyt navn til holdet.</p>

              <input
                autoFocus
                type="text"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 mb-6 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Indtast holdnavn"
                onKeyDown={e => { if(e.key === 'Enter') executeRenameTeam() }}
              />

              <div className="flex gap-3">
                <button onClick={() => setRenameTeamPrompt({isOpen: false, teamId: null, currentName: ''})} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors">Annuller</button>
                <button onClick={executeRenameTeam} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm">Gem navn</button>
              </div>
            </div>
          </div>
        )}

        {validationModal.isOpen && (() => {
          const rowsToCheck = validationModal.scope === 'active'
            ? data.filter(r => r.id === activeRowId)
            : data.filter(r => r.teams.length > 0 && r.pools.length > 0);
          const allConflicts = collectAllConflicts(rowsToCheck);
          const unresolvedCount = allConflicts.filter(c => !c.resolved).length;

          const grouped = {};
          allConflicts.forEach(c => {
            if (!grouped[c.rowId]) grouped[c.rowId] = { rowName: c.rowName, rowId: c.rowId, pools: {} };
            if (!grouped[c.rowId].pools[c.poolId]) grouped[c.rowId].pools[c.poolId] = { poolName: c.poolName, poolId: c.poolId, conflicts: [] };
            grouped[c.rowId].pools[c.poolId].conflicts.push(c);
          });

          // Evaluer ønsker: find relevante datoer fra rækker og tjek opfyldelse
          const rowDates = new Set();
          rowsToCheck.forEach(r => {
            const dm = r.name.match(/\d{1,2}\/\d{1,2}/);
            if (dm) rowDates.add(dm[0]);
          });
          const relevantWishes = wishes.filter(w => {
            if (!w.isActive) return false;
            if (w.ruleType === 'OBS' || w.ruleType === 'UNKNOWN') return false;
            const wishDate = wishCategoryToDateStr(w.kategori);
            if (wishDate && !rowDates.has(wishDate)) return false; // Dato ikke repræsenteret
            // Tjek at mindst én række matcher ønskets filtre
            return rowsToCheck.some(r => isWishApplicableToRow(w, r.name));
          });
          const fulfilledWishes = [];
          const unfulfilledWishes = [];
          relevantWishes.forEach(w => {
            const matchingRows = rowsToCheck.filter(r => isWishApplicableToRow(w, r.name));
            let fulfilled = false;
            let comment = '';
            if (w.ruleType === 'FORCE_HOST') {
              const hosted = matchingRows.some(r => r.teams.some(t => t.isHost && !t.isBye && t.poolId !== null && matchClubName(t.club, w.club)));
              fulfilled = hosted;
              comment = hosted ? `${w.club} er tildelt som vært` : `${w.club} er ikke vært i nogen pulje`;
            } else if (w.ruleType === 'AVOID_HOST') {
              const isHosting = matchingRows.some(r => r.teams.some(t => t.isHost && !t.isBye && t.poolId !== null && matchClubName(t.club, w.club)));
              fulfilled = !isHosting;
              comment = !isHosting ? `${w.club} er ikke vært (korrekt)` : `${w.club} er vært — bør undgås`;
            } else if (w.ruleType === 'SAME_POOL') {
              // Find alle hold fra klubben i matchende rækker og tjek om de er i samme pulje
              const clubHolds = [];
              matchingRows.forEach(r => {
                r.teams.filter(t => !t.isBye && t.poolId !== null && matchClubName(t.club, w.club)).forEach(t => clubHolds.push({ row: r, team: t }));
              });
              if (clubHolds.length >= 2) {
                const allSamePool = clubHolds.every(h => h.team.poolId === clubHolds[0].team.poolId && h.row.id === clubHolds[0].row.id);
                fulfilled = allSamePool;
                comment = allSamePool ? `Hold fra ${w.club} er i samme pulje` : `Hold fra ${w.club} er fordelt i forskellige puljer`;
              } else {
                fulfilled = true;
                comment = `Kun ${clubHolds.length} hold fundet — ikke relevant`;
              }
            } else if (w.ruleType === 'AVOID_CLUB') {
              const hasConflict = allConflicts.some(c => c.type === 'AVOID_CLUB_VIOLATION' && c.wishClub?.toLowerCase() === w.club.toLowerCase());
              fulfilled = !hasConflict;
              comment = !hasConflict ? `${w.club} undgår ønskede modstandere` : `${w.club} møder en modstander de gerne ville undgå`;
            } else if (w.ruleType === 'SAME_LOCATION') {
              fulfilled = false;
              comment = 'Lokation tjekkes ikke automatisk';
            }
            (fulfilled ? fulfilledWishes : unfulfilledWishes).push({ wish: w, comment });
          });

          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-2xl max-h-[80vh] flex flex-col">
                <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6 text-blue-600" />
                  Validering af fordeling
                </h3>
                <p className="text-gray-600 mb-4 text-sm">
                  {allConflicts.length === 0
                    ? 'Ingen konflikter fundet! Alle puljer ser gode ud.'
                    : `${unresolvedCount} uløst${unresolvedCount !== 1 ? 'e' : ''} konflikt${unresolvedCount !== 1 ? 'er' : ''} fundet.`
                  }
                </p>

                {allConflicts.length === 0 ? (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
                    <div className="text-center py-4">
                      <Check className="w-12 h-12 text-green-500 mx-auto mb-2" />
                      <p className="text-green-700 font-semibold text-lg">Alt ser godt ud!</p>
                      <p className="text-gray-500 text-sm mt-1">Ingen konflikter i nogen puljer.</p>
                    </div>

                    {relevantWishes.length > 0 && (
                      <>
                        {fulfilledWishes.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-sm text-green-700 mb-2 flex items-center gap-1.5">
                              <Check className="w-4 h-4" /> Opfyldte ønsker ({fulfilledWishes.length})
                            </h4>
                            <div className="space-y-1">
                              {fulfilledWishes.map((item, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-green-50 border border-green-200 text-xs">
                                  <Check className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-bold text-green-800">{item.wish.club}</span>
                                    <span className="text-green-700 ml-1">({RULE_TYPES.find(r => r.id === item.wish.ruleType)?.label})</span>
                                    {item.wish.kategori !== 'Generelle ønsker' && <span className="text-green-600 ml-1">— {item.wish.kategori}</span>}
                                    <p className="text-green-600 mt-0.5">{item.comment}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {unfulfilledWishes.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-sm text-red-700 mb-2 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4" /> Ikke-opfyldte ønsker ({unfulfilledWishes.length})
                            </h4>
                            <div className="space-y-1">
                              {unfulfilledWishes.map((item, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200 text-xs">
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-bold text-red-800">{item.wish.club}</span>
                                    <span className="text-red-700 ml-1">({RULE_TYPES.find(r => r.id === item.wish.ruleType)?.label})</span>
                                    {item.wish.kategori !== 'Generelle ønsker' && <span className="text-red-600 ml-1">— {item.wish.kategori}</span>}
                                    <p className="text-red-600 mt-0.5">{item.comment}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
                    {Object.values(grouped).map(rowGroup => (
                      <div key={rowGroup.rowId}>
                        <h4 className="font-semibold text-sm text-gray-700 mb-2 sticky top-0 bg-white py-1 z-10 border-b border-gray-100">
                          {rowGroup.rowName}
                        </h4>
                        {Object.values(rowGroup.pools).map(poolGroup => {
                          const allResolved = poolGroup.conflicts.every(c => c.resolved);
                          const row = data.find(r => r.id === rowGroup.rowId);

                          return (
                            <div key={poolGroup.poolId}
                                 className={`border rounded-lg mb-2 transition-colors duration-300 ${allResolved ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50/50'}`}>
                              <div className="flex items-center justify-between p-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                  {allResolved
                                    ? <Check className="w-4 h-4 text-green-600" />
                                    : <AlertCircle className="w-4 h-4 text-red-500" />
                                  }
                                  <span className={`font-medium text-sm ${allResolved ? 'text-green-700' : 'text-gray-800'}`}>{poolGroup.poolName}</span>
                                  {allResolved && <span className="text-xs text-green-600 font-medium ml-1">Løst</span>}
                                </div>
                                <button
                                  onClick={() => handleNavigateToPool(rowGroup.rowId, poolGroup.poolId)}
                                  className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md hover:bg-blue-200 transition-colors font-medium flex items-center gap-1"
                                >
                                  <ChevronRight className="w-3 h-3" /> Gå til pulje
                                </button>
                              </div>

                              <div className="p-3 space-y-2">
                                {poolGroup.conflicts.map((conflict, idx) => {
                                  const recs = row ? getFixRecommendations(conflict, row) : [];
                                  return (
                                    <div key={idx} className={`p-2.5 rounded-md text-xs transition-colors duration-300 ${conflict.resolved ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-white border border-red-200 text-red-800'}`}>
                                      <div className="flex items-center gap-1.5 mb-1">
                                        {conflict.resolved
                                          ? <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                                          : <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                                        }
                                        <span className="font-medium">{conflict.message}</span>
                                        {conflict.type === 'BANE_CAPACITY_CONFLICT' && (() => {
                                          const clubData = clubs.find(c => matchClubName(c.name, conflict.hostClub));
                                          if (!clubData?.comment) return null;
                                          return (
                                            <span className="relative group/baneinfo ml-1">
                                              <MessageSquare className="w-3.5 h-3.5 text-blue-400 cursor-help flex-shrink-0" />
                                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/baneinfo:block bg-gray-800 text-white text-xs rounded-lg px-3 py-2 whitespace-pre-wrap max-w-xs z-50 shadow-lg pointer-events-none">
                                                {clubData.comment}
                                              </span>
                                            </span>
                                          );
                                        })()}
                                        {conflict.resolved && <span className="text-green-600 ml-1">(Løst via nøgler)</span>}
                                      </div>

                                      {!conflict.resolved && recs.length > 0 && (
                                        <div className="mt-2 ml-5">
                                          <select
                                            defaultValue=""
                                            onChange={(e) => {
                                              const recIdx = parseInt(e.target.value);
                                              if (!isNaN(recIdx)) recs[recIdx].action();
                                              e.target.value = "";
                                            }}
                                            className="w-full text-xs border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-800 focus:ring-2 focus:ring-blue-300 outline-none cursor-pointer"
                                          >
                                            <option value="" disabled>Vælg løsning...</option>
                                            {recs.map((rec, ri) => (
                                              <option key={ri} value={ri}>{rec.label}</option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}

                    {relevantWishes.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        {fulfilledWishes.length > 0 && (
                          <div className="mb-3">
                            <h4 className="font-semibold text-sm text-green-700 mb-2 flex items-center gap-1.5">
                              <Check className="w-4 h-4" /> Opfyldte ønsker ({fulfilledWishes.length})
                            </h4>
                            <div className="space-y-1">
                              {fulfilledWishes.map((item, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-green-50 border border-green-200 text-xs">
                                  <Check className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-bold text-green-800">{item.wish.club}</span>
                                    <span className="text-green-700 ml-1">({RULE_TYPES.find(r => r.id === item.wish.ruleType)?.label})</span>
                                    {item.wish.kategori !== 'Generelle ønsker' && <span className="text-green-600 ml-1">— {item.wish.kategori}</span>}
                                    <p className="text-green-600 mt-0.5">{item.comment}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {unfulfilledWishes.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-sm text-red-700 mb-2 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4" /> Ikke-opfyldte ønsker ({unfulfilledWishes.length})
                            </h4>
                            <div className="space-y-1">
                              {unfulfilledWishes.map((item, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200 text-xs">
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-bold text-red-800">{item.wish.club}</span>
                                    <span className="text-red-700 ml-1">({RULE_TYPES.find(r => r.id === item.wish.ruleType)?.label})</span>
                                    {item.wish.kategori !== 'Generelle ønsker' && <span className="text-red-600 ml-1">— {item.wish.kategori}</span>}
                                    <p className="text-red-600 mt-0.5">{item.comment}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-gray-200 mt-4 flex-shrink-0">
                  <button
                    onClick={() => setValidationModal({ isOpen: false, scope: null })}
                    className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                      unresolvedCount === 0
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {unresolvedCount === 0 ? 'Perfekt! Luk validering' : 'Luk'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <div id="pdf-print-view" className="hidden bg-white text-black font-sans">
        {pdfPages.map((page, pageIdx) => (
          <div key={`page-${pageIdx}`} id={`pdf-page-${pageIdx}`} className="flex flex-col bg-white" style={{ height: '793px', width: '1122px', padding: '38px', boxSizing: 'border-box', overflow: 'hidden' }}>
            {pageIdx === 0 && (
              <div className="border-b-2 border-green-700 pb-2 mb-4 flex items-center gap-2">
                <span className="text-lg">⚽</span>
                <h1 className="text-lg font-bold text-gray-900">
                  Samlet Stævneplan <span className="font-normal text-gray-600 text-sm ml-1">{pdfDatesText}</span>
                </h1>
              </div>
            )}
            <div className="grid grid-cols-4 gap-4 items-start flex-1 content-start">
              {page.map(item => {
                const { pool, row } = item;
                const poolTeams = row.teams.filter(t => t.poolId === pool.id);
                const isOrgModePdf = (pool.hostMode || 'host') === 'organizer';
                const hostTeam = isOrgModePdf ? null : poolTeams.find(t => t.isHost);
                const regularTeams = isOrgModePdf ? poolTeams : poolTeams.filter(t => !t.isHost);

                const pdfRowIs3v3 = row.name.includes('3:3');
                const pdfPoolIs3v3 = pool.formatOverride ? pool.formatOverride === '3:3' : pdfRowIs3v3;
                const pdfPoolMats = pdfPoolIs3v3 ? fodaMatrices3v3 : fodaMatrices;
                const pdfPoolDefs = pdfPoolIs3v3 ? defaultTemplates3v3 : defaultTemplates;
                const currentTemplate = (pool.templateKey && pdfPoolMats[pool.templateKey]?.size === poolTeams.length)
                    ? pool.templateKey
                    : (pdfPoolDefs[poolTeams.length] || 'Ingen skabelon valgt');

                const isHostRenamedBye = hostTeam && hostTeam.isBye && hostTeam.name !== 'Oversidder';

                return (
                  <div key={item.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white page-break-inside-avoid shadow-sm">
                    <div className="bg-gray-200 border-b border-gray-300 p-1.5 font-bold text-[11px] text-gray-800 text-center truncate">
                      {row.name}
                    </div>
                    <div className="bg-gray-50 border-b border-gray-300 p-1.5 font-bold text-[11px] flex justify-between items-center">
                      {pool.name}
                      <span className="text-[9px] font-normal text-gray-500 bg-white px-1.5 py-0.5 rounded-full border leading-none">{poolTeams.length} hold</span>
                    </div>
                    
                    <div className="bg-blue-50/50 border-b border-gray-200 p-1 font-medium text-[8px] text-gray-600 flex justify-center items-center gap-1">
                      <Grid className="w-2.5 h-2.5 opacity-70" />
                      Skabelon: {currentTemplate}
                    </div>

                    <div className="bg-gray-50/50 border-b border-gray-200 p-1 font-medium text-[8px] text-gray-500 flex justify-center items-center gap-1">
                      <Clock className="w-2.5 h-2.5 opacity-70" />
                      Kl. {(() => {
                        const spec = pool.specificCriteria || {};
                        return spec.startTime || criteria.defaultPoolStartTime || '10:00';
                      })()}
                    </div>

                        {isOrgModePdf ? (
                          <div className="p-1.5 border-b border-gray-200 flex items-center gap-1.5 bg-green-50">
                            <MapPin className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                            <div className="w-full overflow-hidden">
                              <div className="text-[8px] font-semibold uppercase leading-none mb-0.5 text-green-800">Arrangørklub</div>
                              <div className="font-bold text-[11px] text-gray-900 leading-none truncate">
                                {pool.organizerClub || 'Ikke valgt'}
                              </div>
                            </div>
                          </div>
                        ) : hostTeam ? (
                          <div className={`p-1.5 border-b border-gray-200 flex items-center gap-1.5 ${isHostRenamedBye ? 'bg-blue-50' : hostTeam.isBye ? 'bg-purple-50' : 'bg-yellow-50'}`}>
                            {hostTeam.isBye ? <Coffee className={`w-3.5 h-3.5 flex-shrink-0 ${isHostRenamedBye ? 'text-blue-600' : 'text-purple-600'}`} /> : <MapPin className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />}
                            <div className="w-full overflow-hidden">
                              <div className={`text-[8px] font-semibold uppercase leading-none mb-0.5 ${isHostRenamedBye ? 'text-blue-800' : hostTeam.isBye ? 'text-purple-800' : 'text-yellow-800'}`}>Værtsklub</div>
                              <div className="font-bold text-[11px] text-gray-900 flex items-center justify-between w-full leading-none">
                                <span className="truncate pr-1 flex items-center gap-0.5">{hostTeam.isPinned && <Lock className="w-2 h-2 text-blue-400 flex-shrink-0" />}{hostTeam.name}</span>
                                <span className={`flex-shrink-0 flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${isHostRenamedBye ? 'bg-blue-200 text-blue-800' : hostTeam.isBye ? 'bg-purple-200 text-purple-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                  <Key className="w-2.5 h-2.5" /> {hostTeam.fodaKey || 1}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : null}

                    <div className="p-1.5">
                      {regularTeams.length > 0 ? (
                        <ul className="space-y-1">
                          {regularTeams.map((team) => {
                            const isRenamedBye = team.isBye && team.name !== 'Oversidder';
                            return (
                              <li key={team.id} className="flex items-center justify-between gap-1 border-b border-gray-100 pb-1 last:border-0 last:pb-0">
                                <div className="flex items-center gap-1.5 overflow-hidden">
                                  {team.isBye ? (
                                    <Coffee className={`w-3 h-3 flex-shrink-0 ${isRenamedBye ? 'text-blue-400' : 'text-purple-400'}`} />
                                  ) : (
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full flex-shrink-0"></div>
                                  )}
                                  {team.isPinned && <Lock className="w-2 h-2 text-blue-400 flex-shrink-0" />}
                                  <span className={`text-[11px] truncate text-gray-800 leading-none ${team.isBye ? (isRenamedBye ? 'text-blue-800 font-medium' : 'text-purple-800 font-medium') : ''}`}>{team.name}</span>
                                </div>
                                <span className={`flex-shrink-0 flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${isRenamedBye ? 'bg-blue-100 text-blue-800' : team.isBye ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-500'}`}>
                                  <Key className="w-2.5 h-2.5" /> {team.fodaKey || '-'}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-gray-400 text-[10px] italic m-0 leading-none">Ingen hold</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="pt-3 border-t border-gray-200 text-center text-[10px] text-gray-500 font-medium" style={{ marginTop: 'auto' }}>
              Side {pageIdx + 1} af {pdfPages.length}
            </div>
          </div>
        ))}
      </div>
      {/* === INTERAKTIV GUIDE-WIZARD (flytbar) === */}
      {guideStep !== null && (
        <div className="fixed z-[100] w-[420px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
             style={{ top: `calc(4rem + ${guideDrag.y}px)`, left: `calc(50% - 210px + ${guideDrag.x}px)` }}>
          <div className="bg-green-700 text-white px-5 py-3 flex justify-between items-center cursor-grab active:cursor-grabbing select-none"
               onMouseDown={handleGuideDragStart}>
            <span className="font-bold text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-300" />
              {GUIDE_STEPS[guideStep - 1].titel}
            </span>
            <span className="text-green-200 text-xs font-medium">{guideStep} / {GUIDE_STEPS.length}</span>
          </div>
          <div className="p-5">
            <p className="text-sm text-gray-700 leading-relaxed">{GUIDE_STEPS[guideStep - 1].tekst}</p>
          </div>
          <div className="px-5 pb-4 flex justify-between items-center">
            <div className="flex gap-1.5">
              {GUIDE_STEPS.map((_, i) => (
                <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i + 1 === guideStep ? 'bg-green-600' : i + 1 < guideStep ? 'bg-green-300' : 'bg-gray-200'}`} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setGuideStep(null)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors">Afvis</button>
              {guideStep < GUIDE_STEPS.length ? (
                <button onClick={() => { const next = guideStep + 1; setGuideStep(next); setActiveTab(GUIDE_STEPS[next - 1].tab); setGuideDrag({ x: 0, y: 0 }); }} className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors">
                  Næste &rarr;
                </button>
              ) : (
                <button onClick={() => setGuideStep(null)} className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors">
                  Afslut
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
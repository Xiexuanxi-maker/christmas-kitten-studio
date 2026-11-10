import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Clapperboard, Clock3, Cloud, Download, ExternalLink, Film, FolderOpen, Gift, ImagePlus, Images, LayoutGrid, LoaderCircle, LockKeyhole, LogIn, Menu, MoreHorizontal, Music2, Pause, Play, Plus, Settings2, ShieldCheck, Sparkles, Upload, Volume2, WandSparkles, X } from 'lucide-react';
import { initialShots, type Shot } from './storyboard';

type Page = 'studio' | 'assets' | 'exports' | 'settings';
type Session = { authenticated: boolean; email?: string; role?: string; configured: { seedance: boolean; ai: boolean; database: boolean; storage: boolean }; loginUrl?: string };
type Job = { id: string; shot_id: string; status: string; video_url?: string; error?: string };
type Asset = { key: string; name: string; url: string; size: number; type: string };
const emptySession: Session = { authenticated: false, configured: { seedance: false, ai: false, database: false, storage: false } };
const storageKey = 'purrfect-studio-storyboard-v2';
const time = (seconds: number) => { const rounded = Math.round(seconds * 10) / 10; return `00:${Math.floor(rounded).toString().padStart(2, '0')}${rounded % 1 ? `.${Math.round((rounded % 1) * 10)}` : ''}`; };
const duration = (seconds: number) => Number(seconds.toFixed(1));
const heroImage = '/images/calendar-hero.png';
const statusLabel = (value: string) => ({ queued: 'In the queue', running: 'Generating', succeeded: 'Ready', failed: 'Failed', cancelled: 'Cancelled', pending: 'In the queue', saving: 'Saving clip', completed: 'Ready' }[value] || value);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: options?.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data as T;
}
function downloadText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const srtTime = (value: number) => { const millis = Math.round(value * 1000); return `00:00:${Math.floor(millis / 1000).toString().padStart(2, '0')},${(millis % 1000).toString().padStart(3, '0')}`; };
function getInitialShots(): Shot[] {
  try { const data = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (Array.isArray(data) && data.length === initialShots.length && data.every((shot: Shot) => initialShots.some(seed => seed.id === shot.id))) return data; } catch { /* Fall back to the authored storyboard. */ }
  return initialShots;
}
function App() {
  const [page, setPage] = useState<Page>('studio');
  const [shots, setShots] = useState<Shot[]>(getInitialShots);
  const [selectedId, setSelectedId] = useState(initialShots[0].id);
  const [session, setSession] = useState<Session>(emptySession);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [modal, setModal] = useState<'export' | 'generate' | 'connect' | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'direction' | 'captions'>('direction');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [isSaved, setIsSaved] = useState(true);
  const [muted, setMuted] = useState(false);
  const [assemblyProgress, setAssemblyProgress] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const shot = shots.find(item => item.id === selectedId) || shots[0];
  const selectedIndex = shots.findIndex(item => item.id === shot.id);
  const readyJobs = jobs.filter(job => (job.status === 'succeeded' || job.status === 'completed') && job.video_url);
  const selectedJob = jobs.find(job => job.shot_id === shot.id && job.video_url && (job.status === 'succeeded' || job.status === 'completed'));
  const totalDuration = Math.max(...shots.map(item => item.end));
  const generatedCount = new Set(readyJobs.map(job => job.shot_id)).size;
  const activeJobIds = jobs.filter(job => ['queued', 'running', 'pending', 'saving'].includes(job.status)).map(job => job.id).join(',');

  useEffect(() => {
    let live = true;
    api<Session>('/session').then(data => {
      if (!live) return; setSession(data);
      if (data.authenticated) {
        api<{ shots: Shot[] }>('/project').then(project => { if (live && project.shots?.length) setShots(project.shots); }).catch(() => {});
        api<{ jobs: Job[] }>('/generations').then(data => { if (live) setJobs(data.jobs || []); }).catch(() => {});
        api<{ assets: Asset[] }>('/assets').then(data => { if (live) setAssets(data.assets || []); }).catch(() => {});
      }
    }).catch(() => {}).finally(() => { if (live) setSessionLoaded(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setPlayhead(value => { const next = value + 0.1; if (next >= totalDuration) { setPlaying(false); return totalDuration; } return next; }), 100);
    return () => clearInterval(timer);
  }, [playing, totalDuration]);
  useEffect(() => {
    if (!playing) return;
    const next = shots.find(item => playhead >= item.start && playhead < item.end);
    if (next) setSelectedId(next.id);
  }, [playing, playhead, shots]);

  useEffect(() => {
    if (!session.authenticated || !activeJobIds) return;
    let live = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const results = await Promise.allSettled(activeJobIds.split(',').map(id => api<Job>(`/generations/${encodeURIComponent(id)}/refresh`, { method: 'POST' })));
      if (live) for (const result of results) if (result.status === 'fulfilled') setJobs(items => items.map(item => item.id === result.value.id ? { ...item, ...result.value } : item));
      refreshing = false;
    };
    const timer = setInterval(refresh, 15000);
    return () => { live = false; clearInterval(timer); };
  }, [session.authenticated, activeJobIds]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.4;
    audio.muted = muted;
    if (playing) audio.play().catch(() => setNotice('Press Preview story again to enable the Christmas soundtrack in your browser.'));
    else audio.pause();
  }, [playing, muted]);
  useEffect(() => {
    if (audioRef.current && Math.abs(audioRef.current.currentTime - playhead) > 0.4) audioRef.current.currentTime = playhead;
  }, [playhead]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (playing) {
      const localTime = Math.max(0, playhead - shot.start);
      if (Math.abs(video.currentTime - localTime) > 0.4) video.currentTime = localTime;
      video.play().catch(() => {});
    } else video.pause();
  }, [playing, selectedJob?.id, muted]);
  useEffect(() => {
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - Math.max(0, playhead - shot.start)) > 0.4) video.currentTime = Math.max(0, playhead - shot.start);
  }, [playhead, shot.start]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busy !== 'generate' && busy !== 'assemble') { event.preventDefault(); setModal(null); }
      if (event.key !== 'Tab' || !dialog) return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, [tabindex="0"]'));
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [modal, busy]);

  const updateShot = (patch: Partial<Shot>) => { setShots(items => items.map(item => item.id === shot.id ? { ...item, ...patch } : item)); setIsSaved(false); };
  const selectShot = (item: Shot) => { setSelectedId(item.id); setPlayhead(item.start); setPlaying(false); };
  const navigate = (next: Page) => { setPage(next); setSidebarOpen(false); setPlaying(false); };
  const save = async () => {
    setBusy('save');
    try {
      if (session.authenticated) await api('/project', { method: 'PUT', body: JSON.stringify({ shots }) });
      localStorage.setItem(storageKey, JSON.stringify(shots)); setIsSaved(true);
      setNotice(session.authenticated ? 'Storyboard saved to your workspace.' : 'Storyboard saved in this browser.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(null); }
  };
  const togglePlay = () => { if (!playing && playhead >= totalDuration) setPlayhead(0); setPlaying(value => !value); };
  const requestGenerate = () => { setPlaying(false); setModal(session.authenticated && session.configured.seedance ? 'generate' : 'connect'); };
  const generate = async () => {
    setBusy('generate');
    try {
      const job = await api<Job>('/generations', { method: 'POST', body: JSON.stringify({ shotId: shot.id, prompt: shot.prompt, duration: duration(shot.end - shot.start), ratio: '9:16', audio: shot.audio }) });
      setJobs(items => [{ ...job, shot_id: shot.id }, ...items]); setModal(null); setNotice('Clip submitted to Seedance. Check Exports for its progress.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(null); }
  };
  const refreshJob = async (job: Job) => {
    setBusy(job.id);
    try { const result = await api<Job>(`/generations/${encodeURIComponent(job.id)}/refresh`, { method: 'POST' }); setJobs(items => items.map(item => item.id === job.id ? { ...item, ...result } : item)); setNotice('Generation status refreshed.'); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(null); }
  };
  const enhance = async () => {
    if (!session.authenticated || !session.configured.ai) { setModal('connect'); return; }
    setBusy('enhance');
    try { const result = await api<{ prompt: string }>('/enhance', { method: 'POST', body: JSON.stringify({ shot, instruction: aiInstruction || 'Polish the cinematic direction, preserving the product, timing and exact visual details.' }) }); updateShot({ prompt: result.prompt }); setNotice('Direction refined. Review it, then save your storyboard.'); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(null); }
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!session.authenticated || !session.configured.storage) { setModal('connect'); event.target.value = ''; return; }
    setBusy('upload');
    try { const body = new FormData(); body.append('file', file); const result = await api<{ asset?: Asset; key?: string; name?: string; url?: string; size?: number; type?: string }>('/assets', { method: 'POST', body }); const item = result.asset || result as Asset; setAssets(items => [item, ...items]); setNotice('Reference uploaded to your asset library.'); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(null); event.target.value = ''; }
  };
  const exportJson = () => { downloadText('christmas-kitten-storyboard-v2.json', JSON.stringify({ title: 'Christmas Kitten Advent Calendar', version: 2, ratio: '9:16', duration: totalDuration, language: 'English', soundtrack: 'Soft Christmas music + ASMR unboxing', shots }, null, 2), 'application/json'); setNotice('Storyboard JSON downloaded.'); };
  const exportSrt = () => { downloadText('christmas-kitten-v2.srt', shots.map((item, index) => `${index + 1}\n${srtTime(item.start)} --> ${srtTime(item.end)}\n${item.subtitle}\n`).join('\n'), 'application/x-subrip'); setNotice('English subtitle file downloaded.'); };
  const assemble = async () => {
    setBusy('assemble'); setAssemblyProgress('Preparing your film…');
    try {
      const { assembleVideo } = await import('./export-video');
      const blob = await assembleVideo(shots, jobs, setAssemblyProgress);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'christmas-kitten-advent-calendar-v2.mp4'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setAssemblyProgress('Your film is ready.'); setNotice('Your 40-second Christmas film is ready to download.');
    } catch (error) { setAssemblyProgress(''); setNotice((error as Error).message); }
    finally { setBusy(null); }
  };
  const imageFor = (item: Shot) => item.image || heroImage;

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <button className="brand" onClick={() => navigate('studio')} aria-label="Purrfect Studio home"><span className="brand-mark"><Gift size={24} strokeWidth={1.7} /><span className="brand-spark">✦</span></span><span>Purrfect<span className="brand-second">STUDIO</span></span></button>
      <div className="workspace-switch"><div className="workspace-icon">P</div><div><strong>My workspace</strong><small>Personal studio</small></div><ChevronDown size={14} /></div>
      <div className="nav-label">CREATE SOMETHING LOVELY</div>
      <nav className="main-nav">
        <button className={page === 'studio' ? 'active' : ''} onClick={() => navigate('studio')}><Clapperboard size={19} />Video studio<span className="nav-active-dot" /></button>
        <button className={page === 'assets' ? 'active' : ''} onClick={() => navigate('assets')}><Images size={19} />Asset library<span className="nav-count">{assets.length}</span></button>
        <button className={page === 'exports' ? 'active' : ''} onClick={() => navigate('exports')}><ArrowDownToLine size={19} />Exports{readyJobs.length > 0 && <span className="nav-count">{readyJobs.length}</span>}</button>
      </nav>
      <div className="sidebar-projects"><div className="nav-label">YOUR PROJECT</div><button onClick={() => navigate('studio')}><span className="project-indicator" />Christmas Kitten<ChevronRight size={13} /></button><span className="project-sub">Advent Calendar · V2</span></div>
      <div className="sidebar-season"><span className="season-star">✧</span><p>A little magic.<br />Every single day.</p><div>THE CHRISTMAS COLLECTION</div><span className="season-tree">♧</span></div>
      <div className="sidebar-bottom"><button className={page === 'settings' ? 'active settings-link' : 'settings-link'} onClick={() => navigate('settings')}><Settings2 size={18} />Workspace settings</button><button className="profile" onClick={() => navigate('settings')}><span className="avatar">X</span><span><strong>{session.authenticated ? 'Your workspace' : 'Local workspace'}</strong><small>{session.authenticated ? 'Administrator' : 'Connect to start creating'}</small></span><ChevronDown size={13} /></button></div>
    </aside>
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><button onClick={() => navigate('studio')}>Projects</button><ChevronRight size={13} /><span>Christmas Kitten</span><span className="version-badge">V2</span></div><div className="topbar-right"><span className="saved-state"><span className={`tiny-dot ${isSaved ? '' : 'unsaved'}`} />{isSaved ? 'All changes saved' : 'Unsaved changes'}</span><button className="icon-button topbar-settings" aria-label="Workspace settings" onClick={() => navigate('settings')}><Settings2 size={18} /></button><span className="top-avatar">X</span></div></header>
      {page === 'studio' ? <>
        <section className="project-header"><div><div className="eyebrow"><span className="mini-star">✦</span> A LITTLE CHRISTMAS MAGIC</div><h1>Christmas, one tiny<br className="heading-break" /> surprise at a time<span className="title-dot">.</span></h1><p>24 kittens. Endless little details. One very merry story.</p></div><div className="project-header-actions"><button className="button secondary" onClick={togglePlay}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pause preview' : 'Preview story'}</button><button className="button primary" onClick={() => setModal('export')}><Download size={15} /> Export <ChevronDown size={14} /></button></div></section>
        <div className="project-meta"><span><span className="format-icon">▯</span> 9:16 Portrait</span><i /><span><Clock3 size={13} />{totalDuration} seconds</span><i /><span><Film size={13} />{shots.length} shots</span><i /><span><Music2 size={13} />Christmas + ASMR</span><span className="meta-right"><span className="tiny-dot" />Storyboard ready</span></div>
        <section className="workbench">
          <div className="storyboard-panel"><div className="panel-title"><h2>Storyboard <span>{shots.length}</span></h2><button className="icon-button" aria-label="Show storyboard export options" onClick={() => setModal('export')}><MoreHorizontal size={18} /></button></div><div className="shot-list">{shots.map((item, index) => <button key={item.id} onClick={() => selectShot(item)} className={`shot-card ${shot.id === item.id ? 'selected' : ''}`}><span className="shot-number">{String(index + 1).padStart(2, '0')}</span><div className="shot-thumb"><img src={imageFor(item)} alt="" loading="lazy" /><span>{duration(item.end - item.start)}s</span></div><div className="shot-description"><strong>{item.title}</strong><span>{time(item.start)} – {time(item.end)}</span><small>{item.category}</small></div>{shot.id === item.id && <span className="selected-marker" />}</button>)}</div><div className="storyboard-footer"><CheckCircle2 size={14} /><span>V2 · Packaging showcase included</span></div></div>
          <div className="preview-panel"><div className="preview-toolbar"><span><span className="tiny-dot" />{selectedJob ? 'GENERATED CLIP' : 'STORYBOARD PREVIEW'}</span><div><button className="icon-button" aria-label="Previous shot" disabled={selectedIndex === 0} onClick={() => selectShot(shots[selectedIndex - 1])}><ArrowLeft size={14} /></button><span>{String(selectedIndex + 1).padStart(2, '0')} <em>/ {String(shots.length).padStart(2, '0')}</em></span><button className="icon-button" aria-label="Next shot" disabled={selectedIndex === shots.length - 1} onClick={() => selectShot(shots[selectedIndex + 1])}><ArrowRight size={14} /></button></div></div>
            <div className="preview-stage"><div className={`portrait-preview shot-visual-${selectedIndex % 4}`}>
              {selectedJob ? <video ref={videoRef} key={selectedJob.id} src={selectedJob.video_url} controls playsInline muted={muted} className="preview-image" /> : <><img key={shot.id} className={`preview-image ${playing ? 'is-playing' : ''}`} src={imageFor(shot)} alt={`${shot.title} — visual storyboard reference`} /><div className="preview-shade" /><div className="preview-topline"><span>THE PURRFECT CHRISTMAS</span><span>✧</span></div><div className="preview-caption"><span className="preview-caption-star">✦</span><p>{shot.subtitle}</p><div className="preview-caption-rule" /></div><span className="reference-label">VISUAL REFERENCE · NOT GENERATED VIDEO</span></>}
            </div><span className="preview-dimension">720 × 1280 <span>·</span> 9:16</span></div>
            <div className="playback-controls"><button className="round-play" aria-label={playing ? 'Pause storyboard preview' : 'Play storyboard preview'} onClick={togglePlay}>{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button><span className="play-time">{time(playhead)} <em>/ {time(totalDuration)}</em></span><input aria-label="Scrub story timeline" type="range" min="0" max={totalDuration} step="0.1" value={playhead} onChange={event => { const value = Number(event.target.value); setPlayhead(value); const next = shots.find(item => value >= item.start && value < item.end); if (next) setSelectedId(next.id); }} /><button className="icon-button audio-toggle" aria-label={muted ? 'Unmute Christmas soundtrack' : 'Mute Christmas soundtrack'} onClick={() => setMuted(value => !value)}><Volume2 size={17} /><span className="audio-preview-label">{muted ? 'Off' : 'On'}</span></button></div>
          </div>
          <div className="inspector-panel"><div className="panel-title"><h2>Shot details</h2><span className="shot-index">SHOT {String(selectedIndex + 1).padStart(2, '0')}</span></div><div className="inspector-tabs"><button className={inspectorTab === 'direction' ? 'active' : ''} onClick={() => setInspectorTab('direction')}>Direction</button><button className={inspectorTab === 'captions' ? 'active' : ''} onClick={() => setInspectorTab('captions')}>Captions & audio</button></div><div className="inspector-content"><div className="detail-kicker">{shot.category}</div><h3>{shot.title}</h3><div className="duration-row"><span><Clock3 size={13} />{time(shot.start)} – {time(shot.end)}</span><strong>{(shot.end - shot.start).toFixed(1).replace('.0', '')} sec</strong></div>
            {inspectorTab === 'direction' ? <><label className="field-label" htmlFor="shot-prompt">VISUAL DIRECTION<span>EN</span></label><textarea id="shot-prompt" className="prompt-textarea" value={shot.prompt} onChange={event => updateShot({ prompt: event.target.value })} /><div className="ai-refine-box"><div><Sparkles size={14} /><span>A little help from AI</span></div><input aria-label="AI refinement instructions" value={aiInstruction} onChange={event => setAiInstruction(event.target.value)} placeholder="e.g. Make the lighting warmer…" /><button onClick={enhance} disabled={busy === 'enhance'}>{busy === 'enhance' ? <LoaderCircle className="spin" size={13} /> : <WandSparkles size={13} />} Refine direction <ArrowUpRight size={13} /></button></div><div className="reference-row"><div><ImagePlus size={16} /><span>Reference library<small>Store your product photos</small></span></div><button className="icon-button" aria-label="Upload product reference" onClick={() => uploadRef.current?.click()}><Plus size={16} /></button></div></> : <><label className="field-label" htmlFor="shot-subtitle">ENGLISH SUBTITLE<span>EN</span></label><textarea id="shot-subtitle" className="subtitle-textarea" value={shot.subtitle} onChange={event => updateShot({ subtitle: event.target.value })} /><label className="field-label" htmlFor="shot-audio">SOUND DIRECTION<Volume2 size={13} /></label><textarea id="shot-audio" className="audio-textarea" value={shot.audio} onChange={event => updateShot({ audio: event.target.value })} /><div className="audio-note"><Music2 size={16} /><p>Soft Christmas music throughout, with close, delicate ASMR details. Review generated sound before editing.</p></div></>}
            </div><div className="inspector-bottom"><button className="button save-button" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{session.authenticated ? 'Save storyboard' : 'Save locally'}</button><button className="button generate-button" onClick={requestGenerate}><Sparkles size={15} /> Generate this shot <ArrowUpRight size={14} /></button><p>Powered by Seedance <span>·</span> 9:16 portrait</p></div></div>
        </section>
        <section className="timeline-section"><div className="timeline-heading"><h2><LayoutGrid size={15} />Your story, at a glance</h2><span>{time(totalDuration)} TOTAL</span></div><div className="timeline-ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span></div><div className="timeline-track">{shots.map((item, index) => <button key={item.id} style={{ flex: item.end - item.start }} className={`timeline-clip ${shot.id === item.id ? 'active' : ''}`} onClick={() => selectShot(item)} title={`${item.title}: ${time(item.start)}–${time(item.end)}`}><img src={imageFor(item)} alt="" /><span>{String(index + 1).padStart(2, '0')}</span>{item.end - item.start >= 4 && <strong>{item.title}</strong>}</button>)}<span className="timeline-playhead" style={{ left: `${playhead / totalDuration * 100}%` }} /></div><div className="music-track"><Music2 size={12} /><span>Soft Christmas music + ASMR unboxing</span><div className="waveform">{Array.from({ length: 75 }, (_, index) => <i key={index} style={{ height: `${3 + ((index * 7 + 3) % 11)}px` }} />)}</div><span>{time(totalDuration)}</span></div></section>
        <footer className="studio-footer"><span>MADE FOR THE LITTLE MOMENTS</span><span>Christmas Kitten Advent Calendar <span>✧</span> Storyboard V2</span></footer>
      </> : page === 'assets' ? <section className="secondary-page"><div className="eyebrow"><span>✦</span> THE DETAILS MAKE THE MAGIC</div><div className="page-title-row"><div><h1>Your little library.</h1><p>Product references, kitten details, and a touch of Christmas.</p></div><button className="button primary" onClick={() => uploadRef.current?.click()} disabled={busy === 'upload'}>{busy === 'upload' ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />} Upload reference</button></div><div className="library-note"><ImagePlus size={19} /><div><strong>A home for your product references.</strong><p>Store your gift set and charm photos securely in your workspace. Library uploads are not automatically attached to video generation.</p></div></div><div className="asset-grid"><article className="asset-card"><img src={heroImage} alt="Christmas kitten acrylic advent calendar visual concept" /><div><strong>Christmas collection</strong><span>Included visual concept · Not a product photograph</span></div></article>{assets.map(asset => <article className="asset-card" key={asset.key}>{asset.type.startsWith('image/') ? <img src={asset.url} alt={asset.name} /> : <div className="file-asset"><Film size={32} /></div>}<div><strong>{asset.name}</strong><span>{(asset.size / 1024).toFixed(0)} KB <a href={asset.url} target="_blank" rel="noreferrer" aria-label={`Open ${asset.name}`}><ExternalLink size={14} /></a></span></div></article>)}<button className="upload-card" onClick={() => uploadRef.current?.click()}><Plus size={24} /><strong>Add something lovely</strong><span>Product photos or video references</span></button></div></section> : page === 'exports' ? <section className="secondary-page"><div className="eyebrow"><span>✦</span> READY FOR THEIR CLOSE-UP</div><div className="page-title-row"><div><h1>From story to screen.</h1><p>Your generated clips and the files that bring them together.</p></div><button className="button primary" onClick={() => setModal('export')}><Download size={15} /> Export storyboard</button></div><div className="export-stats"><div><span>PROJECT LENGTH</span><strong>{totalDuration}<small>seconds</small></strong></div><div><span>GENERATED SHOTS</span><strong>{generatedCount}<small>/ {shots.length}</small></strong></div><div><span>FORMAT</span><strong>9:16<small>portrait</small></strong></div></div>{jobs.length ? <div className="jobs-list">{jobs.map(job => <article className="job-card" key={job.id}><span className={`job-status-icon ${job.status === 'failed' ? 'failed' : ''}`}>{job.video_url ? <CheckCircle2 size={21} /> : <Film size={21} />}</span><div><h3>{shots.find(item => item.id === job.shot_id)?.title || 'Generated shot'}</h3><span>{statusLabel(job.status)}</span>{job.error && <p>{job.error}</p>}</div><button className="button secondary" disabled={busy === job.id} onClick={() => refreshJob(job)}>{busy === job.id ? <LoaderCircle className="spin" size={14} /> : <Cloud size={14} />} Refresh</button>{job.video_url && <a className="button primary" href={job.video_url} download><Download size={14} /> Clip</a>}</article>)}</div> : <div className="empty-state"><div><Clapperboard size={32} strokeWidth={1.3} /><span>✦</span></div><h2>Every great film starts with a little story.</h2><p>Your storyboard is ready. Choose a shot in the studio to generate your first clip.</p><button className="button primary" onClick={() => navigate('studio')}>Back to the studio <ArrowRight size={15} /></button></div>}<div className="export-note"><Film size={17} /><p>When every shot is ready, export a complete 40-second MP4 with English subtitles and a gentle Christmas soundtrack. You can also download individual clips.</p></div></section> : <section className="secondary-page settings-page"><div className="eyebrow"><span>✦</span> YOUR CREATIVE CORNER</div><h1>A home for your ideas.</h1><p>Workspace access and service connections.</p><div className="settings-card"><div className="settings-card-heading"><ShieldCheck size={21} /><div><h2>Workspace administrator</h2><p>Only your verified email can manage this project.</p></div><span className={`connection-badge ${session.authenticated ? 'connected' : ''}`}>{session.authenticated ? 'Signed in' : 'Local mode'}</span></div><div className="admin-account"><span className="avatar">X</span><div><strong>xiexuanxi@outlook.fr</strong><span>{session.authenticated ? 'Verified administrator' : 'Sign in through Cloudflare Access to verify ownership'}</span></div>{session.authenticated ? <CheckCircle2 size={19} /> : <LockKeyhole size={19} />}</div>{!session.authenticated && <button className="button primary" onClick={() => session.loginUrl ? window.location.assign(session.loginUrl) : setNotice('Cloudflare Access must be configured during deployment. Your local storyboard remains available.')}><LogIn size={15} /> Sign in with email <ArrowUpRight size={14} /></button>}</div><div className="settings-card"><div className="settings-card-heading"><Cloud size={21} /><div><h2>Connected services</h2><p>Cloudflare infrastructure. Seedance video generation.</p></div></div>{[{ key: 'seedance', label: 'Seedance', desc: 'Video generation · external model API' }, { key: 'ai', label: 'Cloudflare Workers AI', desc: 'Direction refinement · Vercel AI SDK' }, { key: 'database', label: 'Cloudflare D1', desc: 'Storyboards and generation history' }, { key: 'storage', label: 'Cloudflare R2', desc: 'Product references and generated clips' }].map(service => <div className="service-row" key={service.key}><span className="service-symbol">{service.key === 'seedance' ? <Sparkles size={18} /> : <Cloud size={18} />}</span><div><strong>{service.label}</strong><small>{service.desc}</small></div><span className={`connection-badge ${session.configured[service.key as keyof Session['configured']] ? 'connected' : ''}`}>{!sessionLoaded ? 'Checking' : session.configured[service.key as keyof Session['configured']] ? 'Connected' : 'Setup required'}</span></div>)}</div><div className="settings-footnote"><LockKeyhole size={15} /><p>Service credentials are configured securely at deployment. They are never stored in your browser. Local editing and storyboard exports work before you connect.</p></div></section>}
    </main>
    <audio ref={audioRef} src="/audio/christmas-bells.wav" preload="none" />
    <input className="sr-only" ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={upload} />
    {notice && <div role="status" className="toast"><CheckCircle2 size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    {modal && <div className="modal-backdrop" onClick={() => busy !== 'generate' && busy !== 'assemble' && setModal(null)}><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" aria-label="Close dialog" disabled={busy === 'generate' || busy === 'assemble'} onClick={() => setModal(null)}><X size={19} /></button><span className="modal-icon">{modal === 'export' ? <Gift size={28} strokeWidth={1.4} /> : modal === 'generate' ? <Sparkles size={28} strokeWidth={1.4} /> : <LockKeyhole size={26} strokeWidth={1.4} />}</span>{modal === 'export' ? <><div className="eyebrow">ALL WRAPPED UP</div><h2 id="modal-title">Take your story with you.</h2><p>Your {totalDuration}-second Christmas story, ready for the next step.</p><button className="export-option" onClick={exportJson}><span><Clapperboard size={21} /></span><div><strong>Storyboard & directions</strong><small>All {shots.length} shots, prompts, timing and audio notes · JSON</small></div><Download size={17} /></button><button className="export-option" onClick={exportSrt}><span><Film size={21} /></span><div><strong>English subtitles</strong><small>Perfectly timed to your storyboard · SRT</small></div><Download size={17} /></button><button className="export-option" onClick={() => { setModal(null); navigate('exports'); }}><span><ArrowDownToLine size={21} /></span><div><strong>Generated clips</strong><small>{generatedCount} of {shots.length} shots ready · View downloads</small></div><ArrowUpRight size={17} /></button><button className="export-option assemble-option" onClick={assemble} disabled={generatedCount < shots.length || busy === 'assemble'}><span>{busy === 'assemble' ? <LoaderCircle className="spin" size={21} /> : <Film size={21} />}</span><div><strong>{busy === 'assemble' ? 'Assembling your film…' : 'Complete Christmas film'}</strong><small>{generatedCount < shots.length ? `Generate all ${shots.length} shots to unlock · MP4` : '40 seconds · English subtitles · Christmas soundtrack · MP4'}</small></div><Download size={17} /></button>{assemblyProgress && <p className="assembly-progress" role="status">{assemblyProgress}</p>}<div className="modal-note">MP4 assembly runs in your browser and may take a few minutes. Keep this tab open. The storyboard preview uses concept images; generated clips form the final film.</div></> : modal === 'generate' ? <><div className="eyebrow">A LITTLE CHRISTMAS MAGIC</div><h2 id="modal-title">Bring this shot to life.</h2><p>Submit “{shot.title}” to Seedance for a portrait video clip.</p><div className="generation-summary"><span>Timeline duration<strong>{duration(shot.end - shot.start)} seconds</strong></span><span>Source footage<strong>{Math.max(4, Math.ceil(shot.end - shot.start))} seconds · trimmed on export</strong></span><span>Output format<strong>9:16 portrait</strong></span><span>Provider<strong>Seedance</strong></span></div><div className="modal-note">Video generation uses your connected Seedance account and may incur provider charges. Short shots may be generated at the model’s minimum length and trimmed during editing. Subtitles are exported separately for crisp, accurate text.</div><button className="button primary modal-action" onClick={generate} disabled={busy === 'generate'}>{busy === 'generate' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy === 'generate' ? 'Submitting…' : 'Generate this shot'}</button></> : <><div className="eyebrow">MAKE YOURSELF AT HOME</div><h2 id="modal-title">Connect your creative studio.</h2><p>{!session.authenticated ? 'Sign in with your administrator email to generate videos, refine directions, and keep your project in the cloud.' : 'This service needs a secure connection before you can use it.'}</p><div className="connect-account"><ShieldCheck size={21} /><div><strong>xiexuanxi@outlook.fr</strong><span>Workspace administrator</span></div></div><div className="modal-note">Cloudflare Access verifies your email. Service connections are configured during deployment. You can keep editing and exporting this storyboard locally.</div><button className="button primary modal-action" onClick={() => { setModal(null); navigate('settings'); }}><Settings2 size={16} /> Open workspace settings <ArrowRight size={15} /></button></>}</section></div>}
  </div>;
}
export default App;

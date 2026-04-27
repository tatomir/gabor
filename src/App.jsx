import { useEffect, useRef, useState } from 'react';
import { drawGaborPatch } from './lib/gaborPatch.js';

const PATCH_SIZE = 340;
const PREVIEW_PATCH_SIZE = 760;
const ERROR_FLASH_MS = 300;
const SUCCESS_HOLD_MS = 140;
const SESSION_LENGTH_MS = 60_000;
const DEFAULT_START_TEXT = 'Loading a current news brief for this day. Please wait a moment.';
const BACKGROUND_LEVEL = 104;
const PREVIEW_FRAME_MS = 1000;

function randomFromRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactText(value, maxLength = 640) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}

async function fetchDailyNewsText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${year}/${month}/${day}`;

  const response = await fetch(url, {
    headers: {
      'Api-User-Agent': 'gabor-visual-acuity-demo',
    },
  });

  if (!response.ok) {
    throw new Error(`News request failed with ${response.status}`);
  }

  const data = await response.json();
  const stories = (data.news || [])
    .map((item) => stripHtml(item.story || ''))
    .filter(Boolean);

  if (!stories.length) {
    return 'No current news brief is available right now, but the game can still start normally.';
  }

  const selectedStory = stories[randomInt(stories.length)];
  return compactText(selectedStory, 640);
}

function createRound() {
  const sharedPatch = {
    size: PATCH_SIZE,
    frequency: randomFromRange(0.018, 0.042),
    sigma: randomFromRange(40, 62),
    contrast: randomFromRange(0.72, 0.98),
    orientation: randomFromRange(0, 180),
    phase: randomFromRange(0, Math.PI * 2),
    aspectRatio: randomFromRange(0.7, 1.3),
    background: BACKGROUND_LEVEL,
    alphaEnvelope: true,
  };

  const variants = [
    sharedPatch,
    sharedPatch,
    {
      ...sharedPatch,
      orientation: (sharedPatch.orientation + randomFromRange(18, 48)) % 180,
    },
    {
      ...sharedPatch,
      frequency: Math.max(0.01, sharedPatch.frequency + randomFromRange(-0.012, 0.012)),
      phase: (sharedPatch.phase + randomFromRange(0.5, 1.6)) % (Math.PI * 2),
      contrast: Math.min(1, Math.max(0.45, sharedPatch.contrast + randomFromRange(-0.18, 0.18))),
    },
  ];

  const shuffled = shuffle(
    variants.map((patch, index) => ({
      id: `patch-${index}-${Math.random().toString(36).slice(2, 8)}`,
      pairId: index < 2 ? 'match' : `unique-${index}`,
      patch,
    }))
  );

  return {
    id: `round-${Math.random().toString(36).slice(2, 10)}`,
    patches: shuffled,
    answerIds: shuffled.filter((item) => item.pairId === 'match').map((item) => item.id),
    reference: sharedPatch,
  };
}

function createPreviewPatch() {
  return {
    size: PREVIEW_PATCH_SIZE,
    frequency: randomFromRange(0.01, 0.022),
    sigma: randomFromRange(72, 104),
    contrast: randomFromRange(0.84, 0.98),
    orientation: randomFromRange(0, 180),
    phase: randomFromRange(0, Math.PI * 2),
    aspectRatio: randomFromRange(0.85, 1.15),
    background: BACKGROUND_LEVEL,
    alphaEnvelope: false,
  };
}

function GaborTile({ patch, state, onPressStart, canvasRef }) {
  useEffect(() => {
    drawGaborPatch(canvasRef.current, patch);
  }, [canvasRef, patch]);

  const stateClasses = {
    idle: 'border-transparent',
    selected: 'border-neutral-950/20',
    success: 'border-emerald-500/45',
    error: 'border-rose-500/45',
  };

  return (
    <button
      type="button"
      onTouchStart={onPressStart}
      onMouseDown={onPressStart}
      className={`flex h-full w-full min-h-0 touch-manipulation select-none items-center justify-center border p-2 transition duration-200 ${stateClasses[state]}`}
      aria-label="Select patch"
    >
      <div className="flex h-full w-full items-center justify-center p-1">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="block h-[min(calc((100vh-3rem)/2),calc((100vw-3rem)/2))] w-[min(calc((100vh-3rem)/2),calc((100vw-3rem)/2))]"
        />
      </div>
    </button>
  );
}

export default function App() {
  const [round, setRound] = useState(() => createRound());
  const [selectedIds, setSelectedIds] = useState([]);
  const [feedback, setFeedback] = useState('idle');
  const [screen, setScreen] = useState('preview');
  const [shouldPauseAfterSuccess, setShouldPauseAfterSuccess] = useState(false);
  const [startText, setStartText] = useState(DEFAULT_START_TEXT);
  const resetTimerRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const canvasRefs = useRef([]);
  const audioContextRef = useRef(null);
  const prefetchedStartTextRef = useRef('');
  const previewCanvasRef = useRef(null);
  const lastTouchStartAtRef = useRef(0);

  useEffect(() => {
    fetchDailyNewsText()
      .then((text) => {
        setStartText(text);
      })
      .catch(() => {
        setStartText(
          'A current news brief could not be loaded right now, but the game can still start normally.'
        );
      });

    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }

      if (sessionTimerRef.current) {
        clearTimeout(sessionTimerRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (screen !== 'preview') {
      return undefined;
    }

    drawGaborPatch(previewCanvasRef.current, createPreviewPatch());

    const intervalId = window.setInterval(() => {
      drawGaborPatch(previewCanvasRef.current, createPreviewPatch());
    }, PREVIEW_FRAME_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [screen]);

  function playErrorTone() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    const context = audioContextRef.current;

    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const filterNode = context.createBiquadFilter();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(320, now);
    oscillator.frequency.exponentialRampToValueAtTime(240, now + 0.16);

    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(900, now);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    oscillator.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  function startNextRound() {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setSelectedIds([]);
    setFeedback('idle');
    setRound(createRound());
  }

  function completeRoundAndAdvance() {
    setSelectedIds([]);
    setFeedback('idle');
    setRound(createRound());
    resetTimerRef.current = null;
  }

  function prefetchStartText() {
    fetchDailyNewsText()
      .then((text) => {
        prefetchedStartTextRef.current = text;
      })
      .catch(() => {
        prefetchedStartTextRef.current =
          'A current news brief could not be loaded right now, but the game can still start normally.'
      });
  }

  function beginSession() {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
    }

    prefetchStartText();
    setSelectedIds([]);
    setFeedback('idle');
    setShouldPauseAfterSuccess(false);
    setScreen('game');
    setRound(createRound());

    sessionTimerRef.current = setTimeout(() => {
      setShouldPauseAfterSuccess(true);
    }, SESSION_LENGTH_MS);
  }

  function runImmediatePress(event, callback) {
    if (event.type === 'touchstart') {
      lastTouchStartAtRef.current = Date.now();
      event.preventDefault();
      callback();
      return;
    }

    if (event.type === 'mousedown' && Date.now() - lastTouchStartAtRef.current < 700) {
      return;
    }

    callback();
  }

  function advanceScreen() {
    if (screen === 'preview') {
      setStartText(prefetchedStartTextRef.current || startText);
      prefetchStartText();
      setScreen('text');
      return;
    }

    if (screen === 'text') {
      beginSession();
    }
  }

  function handleTileClick(id) {
    if (screen !== 'game' || feedback === 'error' || feedback === 'success') {
      return;
    }

    if (selectedIds.includes(id)) {
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      return;
    }

    const nextSelection = [...selectedIds, id];
    setSelectedIds(nextSelection);

    if (nextSelection.length < 2) {
      return;
    }

    const isCorrect = nextSelection.every((selectedId) => round.answerIds.includes(selectedId));

    if (isCorrect) {
      setFeedback('success');
      resetTimerRef.current = setTimeout(() => {
        if (shouldPauseAfterSuccess) {
          setSelectedIds([]);
          setFeedback('idle');
          setStartText(prefetchedStartTextRef.current || DEFAULT_START_TEXT);
          setScreen('preview');
          prefetchStartText();
          resetTimerRef.current = null;
          return;
        }

        completeRoundAndAdvance();
      }, SUCCESS_HOLD_MS);
      return;
    }

    setFeedback('error');
    playErrorTone();
    resetTimerRef.current = setTimeout(() => {
      setSelectedIds([]);
      setFeedback('idle');
      resetTimerRef.current = null;
    }, ERROR_FLASH_MS);
  }

  function getTileState(id) {
    const isSelected = selectedIds.includes(id);

    if (!isSelected) {
      return 'idle';
    }

    if (feedback === 'error') {
      return 'error';
    }

    if (feedback === 'success') {
      return 'success';
    }

    return 'selected';
  }

  canvasRefs.current = round.patches.map((_, index) => canvasRefs.current[index] ?? { current: null });

  return (
    <main
      className={`h-screen overflow-hidden p-3 text-neutral-900 touch-manipulation select-none ${
        screen === 'text' ? 'bg-white' : 'bg-[#686868]'
      }`}
      onTouchStart={screen === 'game' ? undefined : (event) => runImmediatePress(event, advanceScreen)}
      onMouseDown={screen === 'game' ? undefined : (event) => runImmediatePress(event, advanceScreen)}
    >
      {screen === 'preview' ? (
        <section className="grid h-full place-items-center">
          <canvas
            ref={previewCanvasRef}
            className="block h-[78vmin] w-[78vmin] max-h-[88vh] max-w-[88vw]"
          />
        </section>
      ) : null}

      {screen === 'text' ? (
        <section className="grid h-full place-items-center">
          <p className="max-h-[50vh] max-w-3xl overflow-hidden px-8 py-6 text-center text-[11px] leading-5 tracking-[0.04em] text-black sm:text-sm sm:leading-6">
            {startText}
          </p>
        </section>
      ) : null}

      {screen === 'game' ? (
        <section className="grid h-full grid-cols-2 grid-rows-2 gap-3">
          {round.patches.map((patchConfig, index) => (
            <div key={patchConfig.id} className="min-h-0">
              <GaborTile
                patch={patchConfig.patch}
                state={getTileState(patchConfig.id)}
                onPressStart={(event) =>
                  runImmediatePress(event, () => handleTileClick(patchConfig.id))
                }
                canvasRef={canvasRefs.current[index]}
              />
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}

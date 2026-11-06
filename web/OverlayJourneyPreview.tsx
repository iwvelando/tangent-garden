import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { loomFit } from "./loom/Drawing";
import { EngineClient, EngineError } from "./engine-client";
import {
  OverlayScenes,
  prepareOverlay,
  type PreparedOverlay,
  type OverlayFailure,
  type OverlayScene,
} from "./overlay-preparation";
import { useQuietFocus } from "./quiet-focus";
import type { PlanarStudy } from "./planar-link";
import type { JourneyVia } from "./JourneyContext";
import type { OverlayGuide } from "./OverlayJourneyGuide";
import {
  overlayJourneyStudy,
  overlayJourneyTitle,
  type OverlayJourney,
  type OverlayKind,
} from "./overlay-journeys";
import "./overlay-journey.css";
import "./journey.css";

type PreviewComponent = ComponentType<{
  entry: {
    study: PlanarStudy;
    via: JourneyVia;
    restoreFocus: (via: JourneyVia) => void;
  };
  journey?: OverlayGuide;
  onReturn: (via: JourneyVia) => void;
}>;
const loaders: Record<OverlayKind, () => Promise<PreviewComponent>> = {
  loom: () => import("./loom/Preview").then((m) => m.LoomPreview),
  garden: () => import("./garden/Preview").then((m) => m.GardenPreview),
  lace: () => import("./lace/Preview").then((m) => m.LacePreview),
  shorten: () => import("./shorten/Preview").then((m) => m.ShortenPreview),
};

function Loading({
  title,
  via,
  onReturn,
  failure,
}: {
  failure?: string;
  title: string;
  via: JourneyVia;
  onReturn: (via: JourneyVia) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const quiet = useQuietFocus(dialog);
  useLayoutEffect(() => {
    if (via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="overlay-journey-loading"
      aria-label="Opening journey"
      onCancel={(e) => {
        e.preventDefault();
        onReturn("keyboard");
      }}
      onPointerDown={quiet.onPointerDown}
      onKeyDownCapture={quiet.onKeyDownCapture}
    >
      <p role={failure ? "alert" : "status"}>
        {failure || `Opening ${title}…`}
      </p>
      <button
        ref={back}
        onClick={(e) => onReturn(e.detail ? "pointer" : "keyboard")}
      >
        Return to my study
      </button>
    </dialog>
  );
}

export function OverlayJourneyPreview({
  journey,
  base,
  via,
  onReturn,
  onOpen,
}: {
  journey: OverlayJourney;
  base: PlanarStudy;
  via: JourneyVia;
  onReturn: (via: JourneyVia) => void;
  onOpen: (kind: OverlayKind, study: PlanarStudy, via: JourneyVia) => void;
}) {
  const [requested, setRequested] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  const desired = useRef(0),
    presented = useRef<number | null>(null);
  const interaction = useRef(via);
  const scenes = useRef(new OverlayScenes());
  const snapshots = useRef(new Map<number, PlanarStudy>());
  const loaded = useRef<Partial<Record<OverlayKind, PreviewComponent>>>({});
  const [, redraw] = useReducer((n) => n + 1, 0);
  const pump = useRef<(supersede?: boolean) => void>(() => {});
  const frozen = (index: number) => {
    if (!snapshots.current.has(index))
      snapshots.current.set(
        index,
        overlayJourneyStudy(journey.steps[index], base),
      );
    return snapshots.current.get(index)!;
  };
  useEffect(() => {
    let live = true,
      working = false,
      epoch = 0;
    let client: EngineClient | undefined;
    let workingIndex = -1;
    const complete = (index: number) => {
      const scene = scenes.current.get(index);
      return !!(scene?.prepared || scene?.failure);
    };
    const present = (index: number) => {
      if (!live || presented.current === index) return;
      presented.current = index;
      setShown(index);
    };
    pump.current = (supersede = false) => {
      if (!live) return;
      const next = desired.current;
      if (complete(next)) present(next);
      if (supersede && working && !complete(next) && workingIndex !== next) {
        epoch++;
        client?.dispose();
        client = undefined;
        working = false;
      }
      if (working) return;
      const want =
        !complete(next) && presented.current !== next
          ? next
          : journey.steps
              .map((_, i) => i)
              .filter((i) => i !== presented.current && !complete(i))
              .sort(
                (a, b) => Math.abs(a - next) - Math.abs(b - next) || a - b,
              )[0];
      if (want === undefined) {
        client?.dispose();
        client = undefined;
        return;
      }
      working = true;
      workingIndex = want;
      const token = ++epoch;
      const engine = (client ??= new EngineClient());
      const study = frozen(want);
      const kind = journey.steps[want].overlay;
      const publish = (scene: OverlayScene) => {
        if (!live || token !== epoch) return;
        try {
          scenes.current.set(want, scene);
        } catch (e) {
          scenes.current.set(want, {
            study,
            failure: { message: (e as Error).message },
          });
        }
        if (desired.current === want) present(want);
        redraw();
      };
      void (async () => {
        const component = await loaders[kind]();
        if (!live || token !== epoch) return;
        loaded.current[kind] = component;
        const prepared = await prepareOverlay(engine, kind, study);
        if (prepared.kind === "loom" && !study.loom!.framing) {
          study.loom!.framing = {
            source: loomFit(prepared.result, "source"),
            image: loomFit(prepared.result, "image"),
          };
        }
        publish({ study, prepared });
      })()
        .catch((error: Error) =>
          publish({
            study,
            failure: {
              message: error.message,
              field: error instanceof EngineError ? error.field : undefined,
            },
          }),
        )
        .finally(() => {
          if (live && token === epoch) {
            working = false;
            pump.current();
          }
        });
    };
    pump.current();
    return () => {
      live = false;
      epoch++;
      client?.dispose();
      scenes.current.clear();
      snapshots.current.clear();
    };
  }, []);
  const pending = shown !== requested;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 300);
    return () => clearTimeout(timer);
  }, [pending, requested]);
  const go = (next: number, via: JourneyVia) => {
    interaction.current = via;
    desired.current = next;
    setRequested(next);
    pump.current(true);
  };
  const scene = shown === null ? undefined : scenes.current.get(shown);
  const step = journey.steps[shown ?? requested];
  const Preview = loaded.current[step.overlay];
  if (shown === null || !scene || !Preview)
    return (
      <Loading
        title={overlayJourneyTitle(step)}
        failure={scene?.failure?.message}
        via={interaction.current}
        onReturn={onReturn}
      />
    );
  const index = shown;
  const guide: OverlayGuide = {
    title: journey.title,
    steps: journey.steps,
    index,
    requested,
    prepared: scene.prepared,
    failure: scene.failure,
    pending,
    slow,
    capture: (
      study: PlanarStudy,
      prepared?: PreparedOverlay,
      failure?: OverlayFailure,
    ) => {
      snapshots.current.set(index, study);
      const old = scenes.current.get(index);
      if (
        !prepared &&
        !failure &&
        old?.failure &&
        JSON.stringify(old.study) === JSON.stringify(study)
      )
        failure = old.failure;
      try {
        scenes.current.set(index, { study, prepared, failure });
      } catch (e) {
        scenes.current.set(index, {
          study,
          failure: { message: (e as Error).message },
        });
      }
      const updated = scenes.current.get(index)!;
      if (
        old?.prepared?.result !== updated.prepared?.result ||
        old?.failure?.message !== updated.failure?.message
      )
        redraw();
    },
    go,
    open: (study, via) => {
      if (!pending) onOpen(step.overlay, structuredClone(study), via);
    },
  };
  return (
    <Preview
      key={index}
      entry={{
        study: scene.study,
        via: interaction.current,
        restoreFocus: () => {},
      }}
      journey={guide}
      onReturn={onReturn}
    />
  );
}

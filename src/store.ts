// Memory: one JSON file you can open in VS Code (data/state.json).
// Phone numbers are stored only as keys of `people`, never sent to the model or the API.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ItemKind = "commitment" | "decision" | "idea";
export type ItemStatus = "open" | "done" | "dropped";

export interface Item {
  id: string; // "i1", "i2", ... (per chat)
  kind: ItemKind;
  text: string;
  status: ItemStatus;
  from: string; // alias of who said it first, e.g. "P1"
  owner?: string; // alias of who owns it (commitments only)
  due?: string; // free text, e.g. "Friday"
  source: "chat" | "meeting";
  createdAt: number;
  updatedAt: number;
  credited?: boolean; // credit message already sent
  resurfaced?: boolean; // reminder already sent
}

export interface Person {
  alias: string; // "P1"
  name?: string; // set via "keeper call me Priya" or terminal "Priya: ..."
  messages: number; // talk-time stats (only shown to the person themselves)
  words: number;
}

export interface Line {
  alias: string;
  text: string;
  ts: number;
}

export interface Chat {
  id: string; // public id: "g1", "g2", ...
  title?: string;
  people: Record<string, Person>; // key = platform sender id (may be a phone number)
  items: Item[];
  recent: Line[]; // rolling window the model sees as context; never exposed by the API
  quietUntil?: number;
  unprompted: number[]; // timestamps of unprompted messages (rate limiting)
  nextItem: number;
}

export interface State {
  chats: Record<string, Chat>; // key = platform space id
  nextChat: number;
}

const RECENT_MAX = 40;

export class Store {
  state: State;
  constructor(private file?: string) {
    this.state = { chats: {}, nextChat: 1 };
    if (file) {
      try {
        this.state = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        // first run
      }
    }
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  chat(spaceKey: string): Chat {
    let c = this.state.chats[spaceKey];
    if (!c) {
      c = {
        id: `g${this.state.nextChat++}`,
        people: {},
        items: [],
        recent: [],
        unprompted: [],
        nextItem: 1,
      };
      this.state.chats[spaceKey] = c;
    }
    return c;
  }

  chatByPublicId(id: string): Chat | undefined {
    return Object.values(this.state.chats).find((c) => c.id === id);
  }

  person(chat: Chat, senderKey: string): Person {
    let p = chat.people[senderKey];
    if (!p) {
      p = { alias: `P${Object.keys(chat.people).length + 1}`, messages: 0, words: 0 };
      chat.people[senderKey] = p;
    }
    return p;
  }

  addLine(chat: Chat, line: Line) {
    chat.recent.push(line);
    if (chat.recent.length > RECENT_MAX) chat.recent.splice(0, chat.recent.length - RECENT_MAX);
  }

  addItem(chat: Chat, it: Omit<Item, "id" | "createdAt" | "updatedAt" | "status">, now: number): Item {
    const item: Item = { ...it, id: `i${chat.nextItem++}`, status: "open", createdAt: now, updatedAt: now };
    chat.items.push(item);
    return item;
  }

  forget(spaceKey: string) {
    const c = this.state.chats[spaceKey];
    if (!c) return;
    c.items = [];
    c.recent = [];
    for (const p of Object.values(c.people)) {
      p.messages = 0;
      p.words = 0;
    }
  }
}

/** Display name for an alias: the person's chosen name, else the alias. */
export function nameOf(chat: Chat, alias: string | undefined): string {
  if (!alias) return "someone";
  const p = Object.values(chat.people).find((x) => x.alias === alias);
  return p?.name ?? alias;
}

import { Component, computed, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { getSocketServerUrl } from './server.config';

type Mark = 'X' | 'O' | null;
interface PlayerInfo { name: string; connected: boolean; }
interface RoomSnapshot {
  code: string;
  status: 'waiting' | 'playing' | 'finished';
  players: { X: PlayerInfo; O: PlayerInfo };
  board: Mark[];
  turn: 'X' | 'O';
  winner: 'X' | 'O' | 'draw' | null;
  winningCells: number[];
  scores: { X: number; O: number; draws: number };
  round: number;
}
interface Ack { ok: boolean; error?: string; room?: RoomSnapshot; code?: string; role?: 'X' | 'O'; }

const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly board = signal<Mark[]>(Array(9).fill(null));
  readonly turn = signal<'X' | 'O'>('X');
  readonly scores = signal({ X: 0, O: 0, draws: 0 });
  readonly winningCells = signal<number[]>([]);
  readonly roundOver = signal(false);
  readonly playerName = signal('Player');
  readonly roomCodeInput = signal('');
  readonly roomCode = signal('');
  readonly role = signal<'X' | 'O' | null>(null);
  readonly roomStatus = signal<'idle' | 'waiting' | 'playing' | 'finished'>('idle');
  readonly roomMessage = signal('');
  readonly copied = signal(false);
  readonly isBusy = signal(false);
  readonly nameX = signal('Player X');
  readonly nameO = signal('Player O');
  readonly status = computed(() => {
    if (this.roomCode() && this.roomStatus() === 'waiting') return 'Waiting for your friend to join…';
    if (this.roundOver() && this.winningCells().length) return `${this.turn()} wins this round!`;
    if (this.roundOver()) return 'It’s a draw!';
    return `Player ${this.turn()}’s turn`;
  });

  private readonly socket: Socket = io(getSocketServerUrl(), { autoConnect: false, reconnection: true });

  constructor() {
    this.socket.on('room-updated', (room: RoomSnapshot) => this.applyRoom(room));
    this.socket.on('room-closed', () => {
      this.roomMessage.set('The room is closed because both players left.');
      this.clearRoom();
    });
    this.socket.on('room-error', (message: string) => this.roomMessage.set(message));
    this.socket.on('disconnect', () => {
      if (this.roomCode()) this.roomMessage.set('Connection to the game laptop was lost. Reconnect when it is online.');
    });
  }

  async createRoom(): Promise<void> {
    this.isBusy.set(true);
    this.roomMessage.set('');
    try {
      const response = await this.request('create-room', { name: this.cleanName() });
      if (response.room && response.code && response.role) {
        this.roomCodeInput.set(response.code);
        this.role.set(response.role);
        this.applyRoom(response.room);
      }
    } catch (error) { this.showError(error); }
    finally { this.isBusy.set(false); }
  }

  async joinRoom(): Promise<void> {
    const code = this.roomCodeInput().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { this.roomMessage.set('Enter the 6-character room code.'); return; }
    this.isBusy.set(true);
    this.roomMessage.set('');
    try {
      const response = await this.request('join-room', { code, name: this.cleanName(), preferredRole: this.role() });
      if (response.room && response.code && response.role) {
        this.role.set(response.role);
        this.applyRoom(response.room);
      }
    } catch (error) { this.showError(error); }
    finally { this.isBusy.set(false); }
  }

  play(index: number): void {
    if (this.roundOver() || this.board()[index]) return;
    if (this.roomCode()) {
      void this.request('play-move', { index }).catch((error) => this.showError(error));
      return;
    }
    const currentTurn = this.turn();
    const next = [...this.board()];
    next[index] = currentTurn;
    this.board.set(next);
    const line = winningLines.find((cells) => cells.every((cell) => next[cell] === currentTurn));
    if (line) {
      this.winningCells.set(line);
      this.roundOver.set(true);
      this.scores.update((score) => ({ ...score, [currentTurn]: score[currentTurn] + 1 }));
      return;
    }
    if (next.every(Boolean)) {
      this.roundOver.set(true);
      this.scores.update((score) => ({ ...score, draws: score.draws + 1 }));
      return;
    }
    this.turn.set(currentTurn === 'X' ? 'O' : 'X');
  }

  newRound(): void {
    if (this.roomCode()) {
      void this.request('new-round', {}).catch((error) => this.showError(error));
      return;
    }
    this.board.set(Array(9).fill(null));
    this.turn.set('X');
    this.winningCells.set([]);
    this.roundOver.set(false);
  }

  resetMatch(): void {
    if (this.roomCode()) {
      void this.request('reset-match', {}).catch((error) => this.showError(error));
      return;
    }
    this.newRound();
    this.scores.set({ X: 0, O: 0, draws: 0 });
  }

  async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.roomCode());
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1800);
    } catch { this.roomMessage.set(`Share this room code with your friend: ${this.roomCode()}`); }
  }

  leaveRoom(): void {
    if (this.roomCode()) this.socket.emit('leave-room');
    this.clearRoom();
    this.roomMessage.set('You left the room.');
  }

  private request(event: string, data: Record<string, unknown>): Promise<Ack> {
    if (this.socket.disconnected) this.socket.connect();
    return new Promise((resolve, reject) => {
      this.socket.timeout(10000).emit(event, data, (error: Error | null, response: Ack) => {
        if (error) { reject(new Error('Cannot reach the game laptop. Make sure the backend and tunnel are running.')); return; }
        if (!response?.ok) { reject(new Error(response?.error || 'The game server returned an error.')); return; }
        this.roomMessage.set('');
        resolve(response);
      });
    });
  }

  private applyRoom(room: RoomSnapshot): void {
    this.roomCode.set(room.code);
    this.board.set(room.board);
    this.turn.set(room.turn);
    this.scores.set(room.scores);
    this.winningCells.set(room.winningCells);
    this.roundOver.set(room.status === 'finished');
    this.roomStatus.set(room.status);
    this.nameX.set(room.players.X.name || 'Player X');
    this.nameO.set(room.players.O.name || 'Player O');
  }

  private clearRoom(): void {
    this.roomCode.set('');
    this.role.set(null);
    this.roomStatus.set('idle');
    this.board.set(Array(9).fill(null));
    this.turn.set('X');
    this.scores.set({ X: 0, O: 0, draws: 0 });
    this.winningCells.set([]);
    this.roundOver.set(false);
    this.nameX.set('Player X');
    this.nameO.set('Player O');
  }

  private cleanName(): string { return this.playerName().trim().slice(0, 18) || 'Player'; }

  private showError(error: unknown): void {
    this.roomMessage.set(error instanceof Error ? error.message : 'Something went wrong. Try again.');
  }
}

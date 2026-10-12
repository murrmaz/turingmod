import { injectable, singleton } from 'tsyringe';
import { Logger } from '../utils/Logger.js';
import type { IRewardHandler } from './interfaces/IRewardHandler.js';

/** Reward title → the handler that reacts to it. */
@injectable()
@singleton()
export class RewardRegistry {
  private handlers = new Map<string, IRewardHandler>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'RewardRegistry' });
  }

  /** Register a handler. Two handlers claiming one reward title is a startup error. */
  register(handler: IRewardHandler): void {
    if (this.handlers.has(handler.rewardTitle)) {
      throw new Error(`Reward handler already registered: ${handler.rewardTitle}`);
    }
    this.handlers.set(handler.rewardTitle, handler);
    this.logger.info(`Registered reward handler: ${handler.rewardTitle}`);
  }

  get(rewardTitle: string): IRewardHandler | undefined {
    return this.handlers.get(rewardTitle);
  }

  getAll(): IRewardHandler[] {
    return [...this.handlers.values()];
  }

  count(): number {
    return this.handlers.size;
  }
}

/**
 * Simple dependency injection container
 * Manages service registration and resolution
 */
export class Container {
  private services = new Map<string, () => unknown>();
  private singletons = new Map<string, unknown>();

  /**
   * Register a service factory
   * Each resolve() call will create a new instance
   */
  register<T>(token: string, factory: () => T): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.services.set(token, factory);
  }

  /**
   * Register a singleton service factory
   * Only one instance will be created and reused
   */
  registerSingleton<T>(token: string, factory: () => T): void {
    if (this.services.has(token) || this.singletons.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.services.set(token, factory);
    // Mark as singleton by storing a placeholder
    this.singletons.set(token, null);
  }

  /**
   * Register an existing instance as a singleton
   */
  registerInstance<T>(token: string, instance: T): void {
    if (this.services.has(token) || this.singletons.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.singletons.set(token, instance);
  }

  /**
   * Resolve a service by token
   */
  resolve<T>(token: string): T {
    // Check if it's a singleton with existing instance
    if (this.singletons.has(token)) {
      const existing = this.singletons.get(token);
      if (existing !== null) {
        return existing as T;
      }
      // Singleton but not yet created - create and cache it
      const factory = this.services.get(token);
      if (!factory) {
        throw new Error(`Service not registered: ${token}`);
      }
      const instance = factory() as T;
      this.singletons.set(token, instance);
      return instance;
    }

    // Not a singleton - create new instance
    const factory = this.services.get(token);
    if (!factory) {
      throw new Error(`Service not registered: ${token}`);
    }
    return factory() as T;
  }

  /**
   * Check if a service is registered
   */
  has(token: string): boolean {
    return this.services.has(token) || this.singletons.has(token);
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.singletons.clear();
  }
}

/**
 * Generic repository interface for CRUD operations
 * Following the Repository pattern for data access abstraction
 */
export interface IRepository<T> {
  /**
   * Find entity by ID
   */
  findById(id: string): Promise<T | null>;

  /**
   * Find all entities matching filter
   */
  findAll(filter?: Partial<T>): Promise<T[]>;

  /**
   * Create a new entity
   */
  create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;

  /**
   * Update an existing entity
   */
  update(id: string, entity: Partial<T>): Promise<T>;

  /**
   * Delete an entity
   */
  delete(id: string): Promise<boolean>;
}

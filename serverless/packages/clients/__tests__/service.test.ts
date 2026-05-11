import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClientService } from '../service';
import type { ClientRepository } from '../repository';
import type { EventEmitter } from '@shared/events/emitter';
import type { Pool } from 'pg';

const mockRepo: ClientRepository = {
  findAll: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
  softDelete: vi.fn(),
  countRelations: vi.fn(),
};

const mockEvents: EventEmitter = { emit: vi.fn().mockResolvedValue({ id: '1' }) };
const mockDb = {} as Pool;
const mockUser = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'admin' as const };

const service = createClientService(mockRepo, mockEvents, mockDb);

beforeEach(() => vi.clearAllMocks());

describe('ClientService.create', () => {
  it('rejects empty name', async () => {
    await expect(service.create({ name: '  ' }, mockUser)).rejects.toThrow('nombre es requerido');
  });

  it('rejects invalid tier', async () => {
    await expect(service.create({ name: 'Acme', tier: 'invalid' }, mockUser)).rejects.toThrow('Tier inválido');
  });

  it('rejects duplicate name', async () => {
    vi.mocked(mockRepo.findByName).mockResolvedValue({ id: 'existing', name: 'Acme' });
    await expect(service.create({ name: 'Acme' }, mockUser)).rejects.toThrow('Ya existe');
  });

  it('creates client and emits event', async () => {
    vi.mocked(mockRepo.findByName).mockResolvedValue(null);
    vi.mocked(mockRepo.create).mockResolvedValue({
      id: 'c1', name: 'Acme', country: 'CO', tier: 'enterprise',
    } as any);

    const result = await service.create({ name: 'Acme', country: 'CO', tier: 'enterprise' }, mockUser);

    expect(result.id).toBe('c1');
    expect(mockEvents.emit).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      event_type: 'client.created',
      entity_id: 'c1',
    }));
  });
});

describe('ClientService.softDelete', () => {
  it('blocks deletion when client has relations', async () => {
    vi.mocked(mockRepo.countRelations).mockResolvedValue({ opps: 2, ctrs: 1 });
    await expect(service.softDelete('c1', mockUser)).rejects.toThrow('oportunidad');
  });

  it('deletes and emits event when no relations', async () => {
    vi.mocked(mockRepo.countRelations).mockResolvedValue({ opps: 0, ctrs: 0 });
    vi.mocked(mockRepo.softDelete).mockResolvedValue({ id: 'c1', name: 'Acme' } as any);

    await service.softDelete('c1', mockUser);
    expect(mockEvents.emit).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      event_type: 'client.deleted',
    }));
  });
});

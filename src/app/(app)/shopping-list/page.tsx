"use client";

import React, { useState } from 'react';
import SearchInput from '@/components/shared/SearchInput';

interface ShoppingItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  supermarket: string;
}

const mockShoppingItems: ShoppingItem[] = [
  { id: 1, name: 'Arroz', category: 'Granos', quantity: 2, supermarket: 'Supermercado A' },
  { id: 2, name: 'Frijoles', category: 'Granos', quantity: 1, supermarket: 'Supermercado B' },
  { id: 3, name: 'Leche', category: 'Lácteos', quantity: 3, supermarket: 'Supermercado A' },
  { id: 4, name: 'Pan', category: 'Panadería', quantity: 1, supermarket: 'Supermercado C' },
  { id: 5, name: 'Huevos', category: 'Proteínas', quantity: 6, supermarket: 'Supermercado B' },
];

const ShoppingListPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = mockShoppingItems.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.supermarket.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Lista de compras</h1>
      <p className="text-muted-foreground">Gestión de tu lista de compras</p>

      <SearchInput
        placeholder="Buscar productos..."
        value={searchTerm}
        onChange={setSearchTerm}
      />

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="border-b p-4">
          <h3 className="text-sm font-medium">Productos en lista</h3>
        </div>
        <div className="p-4">
          <div className="grid gap-4">
            {filteredItems.length > 0 ? (
              filteredItems.map(item => (
                <div key={item.id} className="flex justify-between items-center p-2 border-b last:border-b-0">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <span className="text-sm text-muted-foreground ml-2">{item.category}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm">Cantidad: {item.quantity}</span>
                    <span className="text-sm text-muted-foreground">{item.supermarket}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No se encontraron productos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShoppingListPage;

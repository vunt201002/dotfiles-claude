export interface CompanyRef {
  id: string;
  name: string;
}

export interface OrderDto {
  id: string;
  totalPrice: string;
  company: CompanyRef | null;
}

export interface OrderNode {
  id: string;
  totalPrice: string;
  purchasingEntity?: { company?: CompanyRef };
}

export function mapDetailOrderToDto(node: OrderNode): OrderDto {
  return {
    id: node.id,
    totalPrice: node.totalPrice,
    company: node.purchasingEntity?.company ?? null,
  };
}

export function mapBulkOrderToDto(node: OrderNode): OrderDto {
  return {
    id: node.id,
    totalPrice: node.totalPrice,
  };
}

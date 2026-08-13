export interface CompanyRef {
  id: string;
  name: string;
}

export interface OrderDto {
  id: string;
  totalPrice: string;
  company?: CompanyRef;
}

export interface OrderNode {
  id: string;
  totalPrice: string;
  purchasingEntity?: { company?: CompanyRef };
}

export const DETAIL_FIELDS = ['id', 'totalPrice', 'purchasingEntity'];
export const BULK_FIELDS = ['id', 'totalPrice', 'purchasingEntity'];

export function mapDetailOrderToDto(node: OrderNode): OrderDto {
  return {
    id: node.id,
    totalPrice: node.totalPrice,
    company: node.purchasingEntity?.company,
  };
}

export function mapBulkOrderToDto(node: OrderNode): OrderDto {
  return {
    id: node.id,
    totalPrice: node.totalPrice,
  };
}

export function isB2B(dto: OrderDto): boolean {
  return Boolean(dto.company);
}

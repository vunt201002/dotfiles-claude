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

export function orderNodeSelection(): string[] {
  return ['id', 'totalPrice', 'purchasingEntity'];
}

export const DETAIL_FIELDS = orderNodeSelection();
export const BULK_FIELDS = orderNodeSelection();

export function mapOrderNodeToDto(node: OrderNode): OrderDto {
  return {
    id: node.id,
    totalPrice: node.totalPrice,
    company: node.purchasingEntity?.company ?? null,
  };
}

export const mapDetailOrderToDto = mapOrderNodeToDto;
export const mapBulkOrderToDto = mapOrderNodeToDto;

export function isB2B(dto: OrderDto): boolean {
  return Boolean(dto.company);
}

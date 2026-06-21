---
type: gotcha
product: wishlist
created: 2026-06-21
updated: 2026-06-21
tags: [joy, wishlist]
---
# Collection `customers` Firestore là grab-bag

3 loại doc khác nhau cùng nằm trong collection `customers`:
- claim dedup: `${shopId}_${shopifyCustomerId}` (docType `customerSyncClaim`)
- guest-email: `${shopId}_guest_${sha256(email)[:16]}`
- customer admin (field `type`)

Query naive sẽ trộn lẫn 3 loại. (Lưu ý liên quan: `getCountUniqueCustomers` lọc field `isGuest` không hề được ghi ở đâu → có thể trả 0.)
File: `repositories/customerSyncClaimRepository.js`, `repositories/customerRepository.js`.

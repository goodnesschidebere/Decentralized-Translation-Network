;; RoyaltyManagement.clar
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-REQUEST-NOT-FOUND (err u101))
(define-constant ERR-INVALID-REQUEST (err u102))
(define-constant ERR-ALREADY-DISTRIBUTED (err u103))
(define-constant ERR-INSUFFICIENT-ROYALTY (err u104))
(define-constant ERR-USER-NOT-FOUND (err u105))
(define-constant ERR-INVALID-SHARE (err u106))
(define-constant ERR-DISTRIBUTION-LOCKED (err u107))

(define-data-var royalty-nonce uint u0)
(define-data-var platform-fee-rate uint u500)
(define-data-var distribution-lock bool false)

(define-map RoyaltyDistributions
  uint
  {
    request-id: uint,
    total-amount: uint,
    translator-share: uint,
    verifier-share: uint,
    creator-share: uint,
    platform-share: uint,
    distributed: bool,
    timestamp: uint
  }
)

(define-map UserRoyalties
  principal
  uint
)

(define-map RequestRoyalties
  uint
  uint
)

(define-read-only (get-distribution (dist-id uint))
  (map-get? RoyaltyDistributions dist-id)
)

(define-read-only (get-user-royalties (user principal))
  (default-to u0 (map-get? UserRoyalties user))
)

(define-read-only (get-request-royalty (request-id uint))
  (default-to u0 (map-get? RequestRoyalties request-id))
)

(define-read-only (get-platform-fee-rate)
  (ok (var-get platform-fee-rate))
)

(define-private (calculate-shares (total uint) (translator principal) (verifiers (list 10 principal)))
  (let (
    (platform-share (/ (* total (var-get platform-fee-rate)) u10000))
    (remaining (- total platform-share))
    (translator-share (/ (* remaining u7000) u10000))
    (verifier-pool (- remaining translator-share))
    (verifier-count (len verifiers))
    (verifier-share (if (> verifier-count u0) (/ verifier-pool verifier-count) u0))
  )
    {
      platform-share: platform-share,
      translator-share: translator-share,
      verifier-share: verifier-share,
      verifier-pool: verifier-pool
    }
  )
)

(define-public (initiate-royalty-distribution
  (request-id uint)
  (total-amount uint)
  (translator principal)
  (verifiers (list 10 principal))
)
  (let (
    (dist-id (var-get royalty-nonce))
    (existing (get-request-royalty request-id))
  )
    (asserts! (is-eq (as-contract tx-sender) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq existing u0) ERR-ALREADY-DISTRIBUTED)
    (asserts! (> total-amount u0) ERR-INSUFFICIENT-ROYALTY)
    (let ((shares (calculate-shares total-amount translator verifiers)))
      (map-set RoyaltyDistributions dist-id
        {
          request-id: request-id,
          total-amount: total-amount,
          translator-share: (get translator-share shares),
          verifier-share: (get verifier-share shares),
          creator-share: u0,
          platform-share: (get platform-share shares),
          distributed: false,
          timestamp: block-height
        }
      )
      (map-set RequestRoyalties request-id dist-id)
      (var-set royalty-nonce (+ dist-id u1))
      (ok dist-id)
    )
  )
)

(define-public (claim-royalty (dist-id uint))
  (let (
    (dist (unwrap! (get-distribution dist-id) ERR-REQUEST-NOT-FOUND))
    (user tx-sender)
  )
    (asserts! (not (get distributed dist)) ERR-ALREADY-DISTRIBUTED)
    (asserts! (not (var-get distribution-lock)) ERR-DISTRIBUTION-LOCKED)
    (var-set distribution-lock true)
    (let (
      (translator (get-translator-from-core (get request-id dist)))
      (verifiers (get-verifiers-from-core (get request-id dist)))
      (is-translator (is-eq user translator))
      (is-verifier (is-some (index-of verifiers user)))
      (amount
        (cond
          (is-translator (get translator-share dist))
          (is-verifier (get verifier-share dist))
          (else u0)
        )
      )
    )
      (asserts! (> amount u0) ERR-NOT-AUTHORIZED)
      (try! (as-contract (stx-transfer? amount tx-sender user)))
      (map-set UserRoyalties user (+ (get-user-royalties user) amount))
      (map-set RoyaltyDistributions dist-id
        (merge dist { distributed: true })
      )
      (var-set distribution-lock false)
      (ok amount)
    )
  )
)

(define-public (distribute-platform-fee (dist-id uint))
  (let (
    (dist (unwrap! (get-distribution dist-id) ERR-REQUEST-NOT-FOUND))
    (platform (as-contract tx-sender))
  )
    (asserts! (is-eq tx-sender platform) ERR-NOT-AUTHORIZED)
    (asserts! (not (get distributed dist)) ERR-ALREADY-DISTRIBUTED)
    (let ((fee (get platform-share dist)))
      (try! (as-contract (stx-transfer? fee tx-sender (var-get platform-wallet))))
      (ok fee)
    )
  )
)

(define-public (set-platform-fee-rate (new-rate uint))
  (begin
    (asserts! (is-eq (as-contract tx-sender) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (<= new-rate u1000) ERR-INVALID-SHARE)
    (var-set platform-fee-rate new-rate)
    (ok true)
  )
)

(define-public (set-platform-wallet (wallet principal))
  (begin
    (asserts! (is-eq (as-contract tx-sender) tx-sender) ERR-NOT-AUTHORIZED)
    (var-set platform-wallet wallet)
    (ok true)
  )
)

(define-data-var platform-wallet principal tx-sender)

(define-read-only (get-translator-from-core (request-id uint))
  (default-to tx-sender (get translator (try! (contract-call? .TranslationCore get-request request-id))))
)

(define-read-only (get-verifiers-from-core (request-id uint))
  (let ((verifs (try! (contract-call? .TranslationCore get-verifications request-id))))
    (map get-verifier verifs)
  )
)

(define-private (get-verifier (entry { verifier: principal, approved: bool }))
  (get verifier entry)
)